import crypto from "node:crypto";
import XLSX from "xlsx";
import { getDatabase } from "./db.js";
import { FORMAL_SALES_OBJECT_RESOLVER_SCOPES, resolveLinkSkuRelationsForRead } from "./capabilities/resolveLinkSkuRelationRead.js";
import { resolveErpSkuBusinessUsages } from "./capabilities/resolveErpSkuBusinessUsage.js";
import { normalizeSalesDetailLine } from "./capabilities/salesDetailNormalizer.js";
import { classifySalesDetailLine } from "./capabilities/classifySalesDetailLine.js";
import { resolveHistoricalRelationForFact } from "./salesObjectRelationHistoryService.js";
import { invalidateProductContributionCache } from "./productContributionReadModel.js";

const IMPORT_TYPE = "erp_sales_daily_preview";
const PARSER_VERSION = "sales-daily-preview-v3-current-v2";
const REQUIRED_HEADERS = ["店铺", "平台货品ID", "平台规格ID", "商家编码", "日期"];
const FIELD_MAP = {
  店铺: "shopName", 平台货品ID: "platformGoodsId", 平台规格ID: "platformSkuId", 商家编码: "merchantSkuCode", 日期: "saleDate",
  销量: "quantity", 销售额: "salesAmount", 成本: "costAmount", 利润: "profitAmount", 收入: "incomeAmount",
  退款金额: "refundAmount", 退货金额: "returnAmount", 邮费收入: "postageIncomeAmount", 未知收入成本: "otherAdjustmentAmount",
  货品成本: "goodsCostAmount", 退货成本: "returnCostAmount", 邮费成本: "postageCostAmount", 费用: "feeAmount", 已收金额: "receivedAmount",
};
const NUMBER_FIELDS = new Set(["quantity", "salesAmount", "costAmount", "profitAmount", "incomeAmount", "refundAmount", "returnAmount", "postageIncomeAmount", "otherAdjustmentAmount", "goodsCostAmount", "returnCostAmount", "postageCostAmount", "feeAmount", "receivedAmount"]);

const text = (value) => String(value ?? "").trim();
const makeId = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const parseJson = (value, fallback = {}) => { try { return JSON.parse(value || ""); } catch { return fallback; } };
const fileDigest = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const versionedDigest = (buffer) => crypto.createHash("sha256").update(buffer).update(`\0${PARSER_VERSION}`).digest("hex");

function numberValue(value) {
  const raw = text(value).replaceAll(",", "");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = text(value);
  const match = raw.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!match) return "";
  const normalized = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const parsed = new Date(`${normalized}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized ? "" : normalized;
}

function readRows(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: true, cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error("Excel中没有可读取的工作表。");
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  const headers = (matrix[0] || []).map(text);
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missingHeaders.length) throw new Error(`缺少必填表头：${missingHeaders.join("、")}`);
  const rows = matrix.slice(1).filter((row) => row.some((cell) => text(cell))).map((values, index) => {
    const raw = Object.fromEntries(headers.map((header, column) => [header || `__column_${column + 1}`, values[column] ?? ""]));
    const rowNumber = index + 2;
    const standard = normalizeSalesDetailLine(raw, { sourceRowNumber: rowNumber });
    const normalized = normalizedFromStandard(standard);
    return { rowNumber, raw, standard, normalized };
  });
  return { sheetName, headers, rows };
}

function normalizedFromStandard(standard) {
  return {
    shopName: standard.shop,
    platformGoodsId: standard.platformGoodsId,
    platformSkuId: standard.platformSkuId,
    merchantSkuCode: standard.merchantSkuCode,
    saleDate: standard.saleDate,
    quantity: standard.quantity,
    salesAmount: standard.salesAmount,
    costAmount: standard.costAmount,
    profitAmount: standard.profitAmount,
    incomeAmount: standard.incomeAmount,
    refundAmount: standard.refundAmount,
    returnAmount: standard.returnAmount,
    postageIncomeAmount: standard.postageIncomeAmount,
    otherAdjustmentAmount: standard.otherAdjustmentAmount,
    goodsCostAmount: standard.goodsCostAmount,
    returnCostAmount: standard.returnCostAmount,
    postageCostAmount: standard.postageCostAmount,
    feeAmount: standard.feeAmount,
    receivedAmount: standard.receivedAmount,
  };
}

function uniqueResult(rows) {
  const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
  return { row: unique.length === 1 ? unique[0] : null, count: unique.length };
}

function findShop(database, shopName) {
  return uniqueResult(database.prepare(`SELECT DISTINCT s.id,s.shopName,s.displayName,s.platform
    FROM sales_shops s LEFT JOIN sales_shop_aliases a ON a.shopId=s.id
    WHERE LOWER(s.shopName)=LOWER(?) OR LOWER(s.displayName)=LOWER(?) OR LOWER(a.rawName)=LOWER(?)`).all(shopName, shopName, shopName));
}

function cached(cache, key, read) {
  if (!cache) return read();
  if (!cache.has(key)) cache.set(key, read());
  return cache.get(key);
}

function identifyRow(database, item, cache = null) {
  const data = item.normalized;
  const missing = [["shopName", "店铺"], ["platformGoodsId", "平台货品ID"], ["platformSkuId", "平台规格ID"], ["merchantSkuCode", "商家编码"], ["saleDate", "日期"]].filter(([field]) => !text(data[field])).map(([, label]) => label);
  if (missing.length) return { category: "error", errorType: "missing_field", message: `缺少或无法识别：${missing.join("、")}` };
  const invalidNumbers = Object.entries(FIELD_MAP).filter(([, field]) => NUMBER_FIELDS.has(field) && text(item.raw[Object.keys(FIELD_MAP).find((key) => FIELD_MAP[key] === field)]) && data[field] === null).map(([, field]) => field);
  if (invalidNumbers.length) return { category: "error", errorType: "invalid_number", message: `数值格式异常：${invalidNumbers.join("、")}` };

  const shopResult = cached(cache?.shops, data.shopName.toLowerCase(), () => findShop(database, data.shopName));
  if (!shopResult.row) return { category: "error", errorType: shopResult.count > 1 ? "ambiguous_shop" : "missing_shop", message: shopResult.count > 1 ? "店铺名称精确匹配到多个系统店铺。" : "店铺未精确匹配到系统店铺。" };
  const linkResult = cached(cache?.links, `${shopResult.row.id}|${data.platformGoodsId}`, () => uniqueResult(database.prepare("SELECT id,title FROM sales_links WHERE shopId=? AND platformGoodsId=?").all(shopResult.row.id, data.platformGoodsId)));
  if (!linkResult.row) return { category: "error", errorType: linkResult.count > 1 ? "ambiguous_link" : "missing_link", message: linkResult.count > 1 ? "店铺与平台货品ID匹配到多个链接。" : "该店铺下未找到平台货品ID对应链接。", shop: shopResult.row };
  const skuResult = cached(cache?.skus, `${linkResult.row.id}|${data.platformSkuId}`, () => uniqueResult(database.prepare("SELECT id,systemGoodsType FROM sales_link_skus WHERE salesLinkId=? AND platformSkuId=?").all(linkResult.row.id, data.platformSkuId)));
  if (!skuResult.row) return { category: "error", errorType: skuResult.count > 1 ? "ambiguous_platform_sku" : "missing_platform_sku", message: skuResult.count > 1 ? "平台规格ID匹配到多个平台SKU。" : "该链接下未找到平台规格ID对应平台SKU。", shop: shopResult.row, link: linkResult.row };
  const erpResult = cached(cache?.erpSkus, data.merchantSkuCode.toLowerCase(), () => uniqueResult(database.prepare("SELECT id,merchantSkuCode FROM erp_skus WHERE LOWER(merchantSkuCode)=LOWER(?)").all(data.merchantSkuCode)));
  if (!erpResult.row) return { category: "error", errorType: erpResult.count > 1 ? "ambiguous_erp_sku" : "missing_erp_sku", message: erpResult.count > 1 ? "商家编码精确匹配到多个ERP SKU。" : "商家编码未匹配到ERP SKU。", shop: shopResult.row, link: linkResult.row, salesLinkSku: skuResult.row };
  const identity = { shop: shopResult.row, link: linkResult.row, salesLinkSku: skuResult.row, erpSku: erpResult.row };
  const existing = cache?.ignoreExistingDailyFacts ? false : cache?.dailyFactKeys ? cache.dailyFactKeys.has(`${skuResult.row.id}|${erpResult.row.id}|${data.saleDate}`) : database.prepare("SELECT id FROM connection_sku_sales_daily_facts WHERE salesLinkSkuId=? AND erpSkuId=? AND saleDate=?").get(skuResult.row.id, erpResult.row.id, data.saleDate);
  if (existing) return { category: "error", errorType: "duplicate_daily_fact", message: "该平台SKU、ERP SKU及日期的日报事实已存在。", ...identity };
  return { category: "identity_ready", errorType: null, message: "身份精确匹配完成，等待统一关系解析。", ...identity };
}

export function classifyResolvedRelationForSalesDaily(item, relation, { database = null } = {}) {
  if (item.result.category === "error") return item;
  const targetErpSkuId = item.result.erpSku.id;
  const mapping = relation?.mappings?.find((row) => row.erpSkuId === targetErpSkuId) || null;
  if (relation?.relationStatus === "active_complete" && relation.isUsable && mapping) return { ...item, result: {
    ...item.result, category: "ready", errorType: null, message: "统一关系解析完整，可进入日报写入候选。",
    mapping: { id: mapping.mappingId, ...mapping }, relationshipShape: relation.relationshipShape,
  } };
  if (relation?.relationStatus === "active_complete") {
    const historical = database ? resolveHistoricalRelationForFact(database, {
      linkSkuId: item.result.salesLinkSku?.id,
      erpSkuId: targetErpSkuId,
      businessDate: item.normalized?.saleDate,
    }) : null;
    if (historical?.classification === "historical_relation_change") return { ...item, result: {
      ...item.result,
      category: "ready",
      errorType: null,
      message: "销售事实符合销售日期当时有效的历史关系；当前关系已按最新权威主数据生效。",
      mapping: { id: null, erpSkuId: historical.erpSkuId, quantity: historical.quantity, salesObjectId: historical.salesObjectId, salesObjectStructureId: historical.structureId },
      relationshipShape: Number(historical.quantity) === 1 ? "single_unit" : "single_multi_quantity",
      relationClassification: "historical_relation_change",
      historicalRelation: historical,
    } };
    return { ...item, result: {
      ...item.result, category: "relation_conflict", errorType: "target_erp_not_in_relation",
      message: "销售事实ERP不属于销售日期当时有效的正式关系。", relationshipShape: relation.relationshipShape,
    } };
  }
  if (relation?.relationStatus === "pending") return { ...item, result: {
    ...item.result, category: "pending_relation", errorType: "relation_pending", message: "链接SKU与ERP SKU关系尚未确认。",
  } };
  if (relation?.relationStatus === "missing") return { ...item, result: {
    ...item.result, category: "missing_relation", errorType: "missing_relation", message: "链接SKU当前没有正式关系或待审核关系。",
  } };
  return { ...item, result: {
    ...item.result, category: "relation_conflict", errorType: relation?.conflicts?.[0]?.code || "relation_resolution_conflict",
    message: relation?.conflicts?.map((row) => row.message).filter(Boolean).join("；") || "链接SKU关系解析失败或存在冲突，禁止进入日报。",
    relationshipShape: relation?.relationshipShape || null,
  } };
}

export function classifySalesDailyPreviewRows(database, items, {
  cache = null,
  ignoreExistingDailyFacts = false,
  onRelationQuery = null,
  onUsageQuery = null,
} = {}) {
  if (cache && ignoreExistingDailyFacts) cache.ignoreExistingDailyFacts = true;
  const prepared = items.map((item) => {
    const standard = item.standard || normalizeSalesDetailLine(item.raw, { sourceRowNumber: item.rowNumber });
    const normalized = item.normalized || normalizedFromStandard(standard);
    if (standard.normalizationStatus !== "valid") return { ...item, standard, normalized, result: null };
    return { ...item, standard, normalized, result: identifyRow(database, { ...item, normalized }, cache) };
  });
  const identityReady = applyDuplicateIdentityRules(prepared.filter((item) => item.result));
  const identityByRow = new Map(identityReady.map((item) => [item.rowNumber, item]));
  const merged = prepared.map((item) => identityByRow.get(item.rowNumber) || item);
  const erpSkuIds = [...new Set(merged.filter((item) => item.result?.category === "identity_ready").map((item) => item.result.erpSku.id))];
  const usages = resolveErpSkuBusinessUsages({ erpSkuIds }, { database, onQuery: onUsageQuery }).results;
  const relationSkuIds = [...new Set(merged.filter((item) => {
    if (item.result?.category !== "identity_ready") return false;
    const usage = usages[item.result.erpSku.id];
    return !usage?.isUsable || usage.usageType === "product";
  }).map((item) => item.result.salesLinkSku.id))];
  const relations = resolveLinkSkuRelationsForRead({ salesLinkSkuIds: relationSkuIds }, {
    database,
    scope: "salesDailyPreview",
    salesObjectResolverEnabled: true,
    enabledScopes: FORMAL_SALES_OBJECT_RESOLVER_SCOPES,
    onOldQuery: onRelationQuery,
    onNewQuery: onRelationQuery,
    logDifference: () => {},
  }).results;

  return merged.map((item) => {
    const standard = item.standard;
    if (standard.normalizationStatus !== "valid") {
      const classification = classifySalesDetailLine(standard);
      return { ...item, result: {
        category: classification.classification,
        errorType: classification.reasonCodes[0] || null,
        message: classification.warnings[0] || (classification.classification === "excluded" ? "非原子明细已排除。" : "销售明细无法分类。"),
        businessClassification: classification.classification,
        classification,
      } };
    }
    if (item.result.category === "error") {
      const classification = classifySalesDetailLine({ ...standard, normalizationStatus: "incomplete", missingFields: [item.result.errorType] });
      return { ...item, result: {
        ...item.result,
        category: "unknown",
        businessClassification: "unknown",
        classification,
      } };
    }
    const usage = usages[item.result.erpSku.id];
    const relation = relations[item.result.salesLinkSku.id] || null;
    const classification = classifySalesDetailLine({
      ...standard,
      salesLinkSkuId: item.result.salesLinkSku.id,
      erpSkuId: item.result.erpSku.id,
    }, { erpSkuBusinessUsage: usage, relation });
    if (classification.classification !== "product_sale") return { ...item, result: {
      ...item.result,
      category: classification.classification,
      errorType: classification.reasonCodes[0] || null,
      message: classification.warnings[0] || `销售明细已分类为${classification.classification}。`,
      businessClassification: classification.classification,
      classification,
      usage,
    } };
    const resolved = classifyResolvedRelationForSalesDaily(item, relation, { database });
    resolved.result.businessClassification = "product_sale";
    resolved.result.classification = classification;
    resolved.result.usage = usage;
    return resolved;
  });
}

function rowPayload(item, result) {
  return {
    ...item.normalized,
    category: result.category,
    salesLinkId: result.link?.id || null,
    salesLinkSkuId: result.salesLinkSku?.id || null,
    erpSkuId: result.erpSku?.id || null,
    mappingId: result.mapping?.id || null,
    matchedShopId: result.shop?.id || null,
    linkTitle: result.link?.title || null,
    factType: result.relationshipShape === "multi_component" ? "combo_component" : "normal",
    businessClassification: result.businessClassification || null,
    usageType: result.usage?.usageType || null,
    classificationReasonCodes: result.classification?.reasonCodes || [],
  };
}

function normalizedFromRaw(raw) {
  return normalizedFromStandard(normalizeSalesDetailLine(raw));
}

function applyDuplicateIdentityRules(classified) {
  const identityGroups = new Map();
  for (const item of classified.filter((row) => row.result.category !== "error")) {
    const key = [item.result.salesLinkSku.id, item.result.erpSku.id, item.normalized.saleDate].join("|");
    const group = identityGroups.get(key) || [];
    group.push(item); identityGroups.set(key, group);
  }
  for (const group of identityGroups.values()) if (group.length > 1) for (const item of group) item.result = { ...item.result, category: "error", errorType: "duplicate_file_identity", message: "文件内同一平台SKU、ERP SKU及日期存在重复记录。" };
  return classified;
}

function amountCoverage(rows, category, field) {
  const nonProductCategories = new Set([
    "excluded",
    "accounting_auxiliary",
    "shipping_adjustment",
    "other_adjustment",
  ]);
  const denominator = rows
    .filter((row) => !nonProductCategories.has(row.result.category))
    .reduce((sum, row) => sum + Math.abs(Number(row.normalized[field] || 0)), 0);
  const numerator = rows.filter((row) => row.result.category === category).reduce((sum, row) => sum + Math.abs(Number(row.normalized[field] || 0)), 0);
  return denominator ? numerator / denominator : null;
}

function summarizeClassified(classified, base = {}) {
  const categories = [
    "ready", "pending_relation", "missing_relation", "relation_conflict",
    "accounting_auxiliary", "shipping_adjustment", "other_adjustment", "unknown", "excluded",
  ];
  const counts = Object.fromEntries(categories.map((category) => [category, 0]));
  for (const item of classified) counts[item.result.category] += 1;
  const dates = classified.map((item) => item.normalized.saleDate).filter(Boolean).sort();
  const amountByCategory = (field) => Object.fromEntries(Object.keys(counts).map((category) => [category, classified.filter((item) => item.result.category === category).reduce((sum, item) => sum + Number(item.normalized[field] || 0), 0)]));
  const salesAmounts = amountByCategory("salesAmount"); const profitAmounts = amountByCategory("profitAmount");
  const sourceSalesAmount = Object.entries(salesAmounts).filter(([category]) => category !== "excluded").reduce((sum, [, value]) => sum + value, 0);
  const sourceProfitAmount = Object.entries(profitAmounts).filter(([category]) => category !== "excluded").reduce((sum, [, value]) => sum + value, 0);
  const pendingItems = classified.filter((item) => ["pending_relation", "missing_relation"].includes(item.result.category));
  const pendingRelationCount = new Set(pendingItems.map((item) => `${item.result.salesLinkSku.id}|${item.result.erpSku.id}`)).size;
  const errorBreakdown = Object.fromEntries(Object.entries(classified.filter((item) => ["unknown", "relation_conflict"].includes(item.result.category)).reduce((result, item) => {
    result[item.result.errorType] = (result[item.result.errorType] || 0) + 1; return result;
  }, {})).sort(([left], [right]) => left.localeCompare(right)));
  const metrics = (selectedCategories, field) => classified
    .filter((item) => selectedCategories.includes(item.result.category))
    .reduce((sum, item) => sum + Number(item.normalized[field] || 0), 0);
  const section = (selectedCategories) => ({
    rows: selectedCategories.reduce((sum, category) => sum + counts[category], 0),
    salesAmount: metrics(selectedCategories, "salesAmount"),
    profitAmount: metrics(selectedCategories, "profitAmount"),
  });
  const classificationSummary = {
    productSale: section(["ready", "pending_relation", "missing_relation", "relation_conflict"]),
    accountingAuxiliary: section(["accounting_auxiliary"]),
    shippingAdjustment: section(["shipping_adjustment"]),
    otherAdjustment: section(["other_adjustment"]),
    unknown: section(["unknown"]),
    excluded: section(["excluded"]),
  };
  const classifiedSalesAmount = Object.entries(classificationSummary).filter(([category]) => category !== "excluded").reduce((sum, [, item]) => sum + item.salesAmount, 0);
  const classifiedProfitAmount = Object.entries(classificationSummary).filter(([category]) => category !== "excluded").reduce((sum, [, item]) => sum + item.profitAmount, 0);
  return {
    ...base, dateStart: dates[0] || null, dateEnd: dates.at(-1) || null, totalRows: classified.length,
    readyRows: counts.ready, pendingRelationRows: counts.pending_relation + counts.missing_relation, pendingConfirmedRows: counts.pending_relation,
    missingRelationRows: counts.missing_relation, relationConflictRows: counts.relation_conflict, pendingRelationCount,
    errorRows: counts.unknown + counts.relation_conflict, identityErrorRows: counts.unknown, errorBreakdown,
    unknownRows: counts.unknown, excludedRows: counts.excluded,
    accountingAuxiliaryRows: counts.accounting_auxiliary,
    shippingAdjustmentRows: counts.shipping_adjustment,
    otherAdjustmentRows: counts.other_adjustment,
    classificationSummary,
    salesAmountCoverage: amountCoverage(classified, "ready", "salesAmount"), profitAmountCoverage: amountCoverage(classified, "ready", "profitAmount"),
    sourceSalesAmount, readySalesAmount: salesAmounts.ready,
    pendingSalesAmount: salesAmounts.pending_relation + salesAmounts.missing_relation,
    errorSalesAmount: salesAmounts.unknown + salesAmounts.relation_conflict,
    sourceProfitAmount, readyProfitAmount: profitAmounts.ready,
    pendingProfitAmount: profitAmounts.pending_relation + profitAmounts.missing_relation,
    errorProfitAmount: profitAmounts.unknown + profitAmounts.relation_conflict,
    classifiedSalesAmount,
    classifiedProfitAmount,
    classificationSalesAmountDifference: sourceSalesAmount - classifiedSalesAmount,
    classificationProfitAmountDifference: sourceProfitAmount - classifiedProfitAmount,
    salesAmountReconciliationDifference: sourceSalesAmount - Object.entries(salesAmounts).filter(([category]) => category !== "excluded").reduce((sum, [, value]) => sum + value, 0),
    profitAmountReconciliationDifference: sourceProfitAmount - Object.entries(profitAmounts).filter(([category]) => category !== "excluded").reduce((sum, [, value]) => sum + value, 0),
  };
}

function buildCandidateGroups(classified, sourceBatchId, sourceFileHash, fileName) {
  const pending = classified.filter((item) => ["pending_relation", "missing_relation"].includes(item.result.category));
  const bySkuDate = new Map();
  for (const item of pending) {
    const key = `${item.result.salesLinkSku.id}|${item.normalized.saleDate}`;
    const erpIds = bySkuDate.get(key) || new Set(); erpIds.add(item.result.erpSku.id); bySkuDate.set(key, erpIds);
  }
  const comboKeys = new Set([...bySkuDate.entries()].filter(([, erpIds]) => erpIds.size > 1).map(([key]) => key));
  const groups = new Map();
  for (const item of pending) {
    const key = `${item.result.salesLinkSku.id}|${item.result.erpSku.id}`;
    const group = groups.get(key) || [];
    group.push(item); groups.set(key, group);
  }
  return [...groups.values()].map((items) => {
    const first = items[0]; const dates = items.map((item) => item.normalized.saleDate).sort();
    const candidateType = items.some((item) => comboKeys.has(`${item.result.salesLinkSku.id}|${item.normalized.saleDate}`)) ? "combo" : "single";
    return {
      id: makeId("sales-relation-candidate"), salesLinkSkuId: first.result.salesLinkSku.id, erpSkuId: first.result.erpSku.id,
      candidateType, sourceBatchId, sourceFileHash, sourceRowNumber: Math.min(...items.map((item) => item.rowNumber)),
      affectedRowCount: items.length, affectedDateStart: dates[0], affectedDateEnd: dates.at(-1),
      salesAmount: items.reduce((sum, item) => sum + Number(item.normalized.salesAmount || 0), 0),
      profitAmount: items.reduce((sum, item) => sum + Number(item.normalized.profitAmount || 0), 0),
      evidence: {
        shop: { sourceName: first.normalized.shopName, shopId: first.result.shop.id, systemName: first.result.shop.displayName || first.result.shop.shopName },
        link: { platformGoodsId: first.normalized.platformGoodsId, salesLinkId: first.result.link.id, title: first.result.link.title },
        platformSku: { platformSkuId: first.normalized.platformSkuId, salesLinkSkuId: first.result.salesLinkSku.id },
        erpSku: { erpSkuId: first.result.erpSku.id, merchantSkuCode: first.normalized.merchantSkuCode },
        source: { sourceType: "sales_daily_preview", fileName, fileHash: sourceFileHash, batchId: sourceBatchId, rowNumber: Math.min(...items.map((item) => item.rowNumber)), rowNumbers: items.map((item) => item.rowNumber) },
      },
    };
  });
}

function insertCandidateRows(database, candidates, createdAt) {
  const insert = database.prepare(`INSERT OR IGNORE INTO sales_link_sku_erp_mapping_candidates (id,salesLinkSkuId,erpSkuId,candidateType,suggestedQuantity,sourceType,sourceBatchId,sourceFileHash,sourceRowNumber,evidenceJson,affectedRowCount,affectedDateStart,affectedDateEnd,salesAmount,profitAmount,status,createdAt,updatedAt) VALUES (?,?,?,?,1,'sales_daily_preview',?,?,?,?,?,?,?,?,?,'pending',?,?)`);
  for (const candidate of candidates) insert.run(candidate.id, candidate.salesLinkSkuId, candidate.erpSkuId, candidate.candidateType, candidate.sourceBatchId, candidate.sourceFileHash, candidate.sourceRowNumber, JSON.stringify(candidate.evidence), candidate.affectedRowCount, candidate.affectedDateStart, candidate.affectedDateEnd, candidate.salesAmount, candidate.profitAmount, createdAt, createdAt);
}

function ensureCandidatesForStoredPreview(database, batch) {
  if (database.prepare("SELECT 1 FROM sales_link_sku_erp_mapping_candidates WHERE sourceBatchId=? LIMIT 1").get(batch.id)) return batch;
  const storedRows = database.prepare("SELECT rowNumber,rawDataJson,normalizedDataJson FROM connection_import_rows WHERE batchId=? AND status IN ('pending_relation','missing_relation') ORDER BY rowNumber").all(batch.id);
  if (!storedRows.length) return batch;
  const classified = storedRows.map((row) => {
    const normalized = parseJson(row.normalizedDataJson); const raw = parseJson(row.rawDataJson);
    return { rowNumber: row.rowNumber, raw, normalized, result: {
      category: "pending_relation",
      shop: database.prepare("SELECT id,shopName,displayName,platform FROM sales_shops WHERE id=?").get(normalized.matchedShopId),
      link: database.prepare("SELECT id,title FROM sales_links WHERE id=?").get(normalized.salesLinkId),
      salesLinkSku: database.prepare("SELECT id,systemGoodsType FROM sales_link_skus WHERE id=?").get(normalized.salesLinkSkuId),
      erpSku: database.prepare("SELECT id,merchantSkuCode FROM erp_skus WHERE id=?").get(normalized.erpSkuId),
    } };
  }).filter((item) => item.result.shop && item.result.link && item.result.salesLinkSku && item.result.erpSku);
  const summary = parseJson(batch.previewSummaryJson); const candidates = buildCandidateGroups(classified, batch.id, summary.sourceFileHash || batch.fileHash, batch.fileName);
  const createdAt = now();
  database.transaction(() => {
    insertCandidateRows(database, candidates, createdAt);
    summary.candidateCount = candidates.length; summary.singleCandidateCount = candidates.filter((item) => item.candidateType === "single").length; summary.comboCandidateCount = candidates.filter((item) => item.candidateType === "combo").length;
    database.prepare("UPDATE connection_import_batches SET previewSummaryJson=?,updatedAt=? WHERE id=?").run(JSON.stringify(summary), createdAt, batch.id);
  })();
  return database.prepare("SELECT * FROM connection_import_batches WHERE id=?").get(batch.id);
}

function response(database, batch, options = {}) {
  const summary = parseJson(batch.previewSummaryJson);
  const currentCoverage = database.prepare(`
    SELECT
      SUM(CASE WHEN status='ready' THEN ABS(COALESCE(CAST(json_extract(normalizedDataJson,'$.salesAmount') AS REAL),0)) ELSE 0 END) readySales,
      SUM(CASE WHEN status='ready' THEN ABS(COALESCE(CAST(json_extract(normalizedDataJson,'$.profitAmount') AS REAL),0)) ELSE 0 END) readyProfit,
      SUM(CASE WHEN status NOT IN ('excluded','accounting_auxiliary','shipping_adjustment','other_adjustment') THEN ABS(COALESCE(CAST(json_extract(normalizedDataJson,'$.salesAmount') AS REAL),0)) ELSE 0 END) productSales,
      SUM(CASE WHEN status NOT IN ('excluded','accounting_auxiliary','shipping_adjustment','other_adjustment') THEN ABS(COALESCE(CAST(json_extract(normalizedDataJson,'$.profitAmount') AS REAL),0)) ELSE 0 END) productProfit
    FROM connection_import_rows WHERE batchId=?
  `).get(batch.id);
  summary.salesAmountCoverage = Number(currentCoverage.productSales || 0)
    ? Number(currentCoverage.readySales || 0) / Number(currentCoverage.productSales || 0)
    : null;
  summary.profitAmountCoverage = Number(currentCoverage.productProfit || 0)
    ? Number(currentCoverage.readyProfit || 0) / Number(currentCoverage.productProfit || 0)
    : null;
  const category = [
    "ready", "pending_relation", "missing_relation", "relation_conflict",
    "accounting_auxiliary", "shipping_adjustment", "other_adjustment", "unknown", "excluded",
  ].includes(text(options.category)) ? text(options.category) : "";
  const page = Math.max(1, Number(options.page || 1));
  const pageSize = Math.min(200, Math.max(1, Number(options.pageSize || 50)));
  const where = category ? "AND status=?" : "";
  const params = category ? [batch.id, category] : [batch.id];
  const total = Number(database.prepare(`SELECT COUNT(*) total FROM connection_import_rows WHERE batchId=? ${where}`).get(...params).total || 0);
  const rows = database.prepare(`SELECT rowNumber,rawDataJson,normalizedDataJson,status category,errorType,errorMessage FROM connection_import_rows WHERE batchId=? ${where} ORDER BY rowNumber LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize).map((row) => ({ ...row, raw: parseJson(row.rawDataJson), normalized: parseJson(row.normalizedDataJson) }));
  return { batch, summary, rows, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

export function previewSalesDailyFacts({ buffer, fileName, createdBy = "" } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("请选择销售日报Excel文件。");
  const database = getDatabase();
  const sourceHash = fileDigest(buffer);
  const hash = `${versionedDigest(buffer)}:analysis:${crypto.randomUUID()}`;
  const workbook = readRows(buffer);
  const classificationCache = {
    shops: new Map(), links: new Map(), skus: new Map(), erpSkus: new Map(),
    dailyFactKeys: new Set(database.prepare("SELECT salesLinkSkuId,erpSkuId,saleDate FROM connection_sku_sales_daily_facts").all().map((item) => `${item.salesLinkSkuId}|${item.erpSkuId}|${item.saleDate}`)),
  };
  const classified = classifySalesDailyPreviewRows(database, workbook.rows, {
    cache: classificationCache,
    ignoreExistingDailyFacts: true,
  });
  const summary = summarizeClassified(classified, {
    parserVersion: PARSER_VERSION,
    sourceFileHash: sourceHash,
    fileName: text(fileName) || "销售日报.xlsx",
    sheetName: workbook.sheetName,
    headers: workbook.headers,
    previewRevision: 1,
  });
  const batchId = makeId("sales-daily-preview"); const createdAt = now();
  const candidates = buildCandidateGroups(classified, batchId, summary.sourceFileHash, summary.fileName);
  summary.candidateCount = candidates.length;
  summary.singleCandidateCount = candidates.filter((item) => item.candidateType === "single").length;
  summary.comboCandidateCount = candidates.filter((item) => item.candidateType === "combo").length;
  database.transaction(() => {
    database.prepare(`INSERT INTO connection_import_batches (id,sourceType,fileName,fileHash,businessDate,periodStart,periodEnd,periodType,status,totalRows,matchedRows,pendingRows,errorRows,createdBy,createdAt,updatedAt,importType,previewSummaryJson)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(batchId, IMPORT_TYPE, summary.fileName, hash, summary.dateEnd || createdAt.slice(0, 10), summary.dateStart, summary.dateEnd, "daily", "preview_ready", summary.totalRows, summary.readyRows, summary.pendingRelationRows, summary.errorRows, text(createdBy) || null, createdAt, createdAt, IMPORT_TYPE, JSON.stringify(summary));
    const insert = database.prepare(`INSERT INTO connection_import_rows (id,batchId,rowNumber,externalKey,rawDataJson,normalizedDataJson,status,errorType,errorMessage,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    for (const item of classified) insert.run(makeId("sales-daily-row"), batchId, item.rowNumber, [item.normalized.shopName, item.normalized.platformGoodsId, item.normalized.platformSkuId, item.normalized.merchantSkuCode, item.normalized.saleDate].join("|"), JSON.stringify(item.raw), JSON.stringify(rowPayload(item, item.result)), item.result.category, item.result.errorType, item.result.message, createdAt);
    insertCandidateRows(database, candidates, createdAt);
  })();
  return { ...response(database, database.prepare("SELECT * FROM connection_import_batches WHERE id=?").get(batchId)), idempotent: false };
}

export function readSalesDailyFactPreview(batchId, options = {}) {
  const database = getDatabase();
  let batch = database.prepare("SELECT * FROM connection_import_batches WHERE id=? AND importType=?").get(text(batchId), IMPORT_TYPE);
  if (!batch) throw new Error("销售日报预览不存在。");
  batch = ensureCandidatesForStoredPreview(database, batch);
  return response(database, batch, options);
}

export function readCurrentSalesDailyFactPreview(options = {}) {
  const database = getDatabase();
  // “当前预览”只展示由现行规则生成的批次。旧解析结果仍可按批次编号
  // 只读查看，但不能继续冒充当前待确认结果。
  const batch = database.prepare(`
    SELECT * FROM connection_import_batches
    WHERE importType=? AND json_extract(previewSummaryJson,'$.parserVersion')=?
    ORDER BY createdAt DESC LIMIT 1
  `).get(IMPORT_TYPE, PARSER_VERSION);
  return batch ? response(database, ensureCandidatesForStoredPreview(database, batch), options) : null;
}

export function evaluateSalesDailyFactCoverage(batchId) {
  const database = getDatabase(); const batch = database.prepare("SELECT * FROM connection_import_batches WHERE id=? AND importType=?").get(text(batchId), IMPORT_TYPE);
  if (!batch) throw new Error("销售日报原始预览不存在。");
  const storedRows = database.prepare("SELECT rowNumber,rawDataJson FROM connection_import_rows WHERE batchId=? ORDER BY rowNumber").all(batch.id);
  const cache = { shops: new Map(), links: new Map(), skus: new Map(), erpSkus: new Map(), dailyFactKeys: new Set(database.prepare("SELECT salesLinkSkuId,erpSkuId,saleDate FROM connection_sku_sales_daily_facts").all().map((item) => `${item.salesLinkSkuId}|${item.erpSkuId}|${item.saleDate}`)) };
  const classified = classifySalesDailyPreviewRows(database, storedRows.map((row) => {
    const raw = parseJson(row.rawDataJson); const item = { rowNumber: row.rowNumber, raw, normalized: normalizedFromRaw(raw) };
    return item;
  }), { cache, ignoreExistingDailyFacts: true });
  const candidates = buildCandidateGroups(classified, batch.id, parseJson(batch.previewSummaryJson).sourceFileHash || batch.fileHash, batch.fileName);
  const rows = classified.map((item) => {
    return { rowNumber: item.rowNumber, category: item.result.category, errorType: item.result.errorType, message: item.result.message || "", raw: item.raw, normalized: item.normalized, identity: { matchedShopId: item.result.shop?.id || null, systemShop: item.result.shop?.displayName || item.result.shop?.shopName || null, salesLinkId: item.result.link?.id || null, salesLinkSkuId: item.result.salesLinkSku?.id || null, erpSkuId: item.result.erpSku?.id || null, mappingId: item.result.mapping?.id || null, mappingType: item.result.mapping?.mappingType || null } };
  });
  return { batch, rows, candidates };
}

function previewAncestors(database, batch) {
  const batches = []; let current = batch;
  while (current) {
    batches.push(current);
    const summary = parseJson(current.previewSummaryJson);
    current = summary.parentBatchId ? database.prepare("SELECT * FROM connection_import_batches WHERE id=? AND importType=?").get(summary.parentBatchId, IMPORT_TYPE) : null;
  }
  return batches;
}

export function recalculateSalesDailyFactPreview(batchId, { createdBy = "" } = {}) {
  const database = getDatabase();
  const sourceBatch = database.prepare("SELECT * FROM connection_import_batches WHERE id=? AND importType=?").get(text(batchId), IMPORT_TYPE);
  if (!sourceBatch) throw Object.assign(new Error("原销售日报预览不存在。"), { code: "preview_not_found" });
  const ancestors = previewAncestors(database, sourceBatch); const ancestorIds = ancestors.map((item) => item.id);
  const placeholders = ancestorIds.map(() => "?").join(",");
  const approved = database.prepare(`SELECT salesLinkSkuId,erpSkuId,mappingId FROM sales_link_sku_erp_mapping_candidates WHERE sourceBatchId IN (${placeholders}) AND status='approved'`).all(...ancestorIds);
  if (!approved.length) throw Object.assign(new Error("当前预览没有已确认的销售关系，不能重新计算。"), { code: "no_approved_relation" });
  const storedRows = database.prepare("SELECT rowNumber,rawDataJson FROM connection_import_rows WHERE batchId=? ORDER BY rowNumber").all(sourceBatch.id);
  if (!storedRows.length) throw new Error("原销售日报预览没有可重新计算的原始行。");
  const classificationCache = {
    shops: new Map(), links: new Map(), skus: new Map(), erpSkus: new Map(),
    dailyFactKeys: new Set(database.prepare("SELECT salesLinkSkuId,erpSkuId,saleDate FROM connection_sku_sales_daily_facts").all().map((item) => `${item.salesLinkSkuId}|${item.erpSkuId}|${item.saleDate}`)),
  };
  const classified = classifySalesDailyPreviewRows(database, storedRows.map((row) => {
    const raw = parseJson(row.rawDataJson); const item = { rowNumber: row.rowNumber, raw, normalized: normalizedFromRaw(raw) };
    return item;
  }), { cache: classificationCache, ignoreExistingDailyFacts: true });
  const previousSummary = parseJson(sourceBatch.previewSummaryJson); const previewRevision = Number(previousSummary.previewRevision || 1) + 1;
  const rootBatchId = previousSummary.rootBatchId || sourceBatch.id;
  const summary = summarizeClassified(classified, {
    parserVersion: PARSER_VERSION, sourceFileHash: previousSummary.sourceFileHash || sourceBatch.fileHash,
    fileName: previousSummary.fileName || sourceBatch.fileName, sheetName: previousSummary.sheetName || null, headers: previousSummary.headers || [],
    previewRevision, rootBatchId, parentBatchId: sourceBatch.id, relationRecalculationRequired: false, recalculatedAt: now(),
  });
  summary.changes = {
    readyRows: summary.readyRows - Number(previousSummary.readyRows || 0),
    pendingRelationRows: summary.pendingRelationRows - Number(previousSummary.pendingRelationRows || 0),
    errorRows: summary.errorRows - Number(previousSummary.errorRows || 0),
    readySalesAmount: summary.readySalesAmount - Number(previousSummary.readySalesAmount || 0),
    readyProfitAmount: summary.readyProfitAmount - Number(previousSummary.readyProfitAmount || 0),
  };
  summary.previousSummary = {
    previewRevision: Number(previousSummary.previewRevision || 1), readyRows: previousSummary.readyRows, pendingRelationRows: previousSummary.pendingRelationRows,
    errorRows: previousSummary.errorRows, salesAmountCoverage: previousSummary.salesAmountCoverage, profitAmountCoverage: previousSummary.profitAmountCoverage,
    readySalesAmount: previousSummary.readySalesAmount, readyProfitAmount: previousSummary.readyProfitAmount,
  };
  const revisionBatchId = makeId("sales-daily-preview"); const createdAt = now();
  const candidates = buildCandidateGroups(classified, revisionBatchId, summary.sourceFileHash, summary.fileName);
  summary.candidateCount = candidates.length; summary.singleCandidateCount = candidates.filter((item) => item.candidateType === "single").length; summary.comboCandidateCount = candidates.filter((item) => item.candidateType === "combo").length;
  database.transaction(() => {
    database.prepare(`INSERT INTO connection_import_batches (id,sourceType,fileName,fileHash,businessDate,periodStart,periodEnd,periodType,status,totalRows,matchedRows,pendingRows,errorRows,createdBy,createdAt,updatedAt,importType,previewSummaryJson)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(revisionBatchId, IMPORT_TYPE, summary.fileName, `${sourceBatch.fileHash}:revision:${previewRevision}:${crypto.randomUUID()}`, summary.dateEnd || createdAt.slice(0, 10), summary.dateStart, summary.dateEnd, "daily", "preview_ready", summary.totalRows, summary.readyRows, summary.pendingRelationRows, summary.errorRows, text(createdBy) || null, createdAt, createdAt, IMPORT_TYPE, JSON.stringify(summary));
    const insert = database.prepare(`INSERT INTO connection_import_rows (id,batchId,rowNumber,externalKey,rawDataJson,normalizedDataJson,status,errorType,errorMessage,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    for (const item of classified) insert.run(makeId("sales-daily-row"), revisionBatchId, item.rowNumber, [item.normalized.shopName, item.normalized.platformGoodsId, item.normalized.platformSkuId, item.normalized.merchantSkuCode, item.normalized.saleDate].join("|"), JSON.stringify(item.raw), JSON.stringify(rowPayload(item, item.result)), item.result.category, item.result.errorType, item.result.message, createdAt);
    insertCandidateRows(database, candidates, createdAt);
  })();
  return { ...response(database, database.prepare("SELECT * FROM connection_import_batches WHERE id=?").get(revisionBatchId)), previousBatchId: sourceBatch.id };
}

const DAILY_FACT_VALUE_FIELDS = [
  "salesLinkId", "salesLinkSkuId", "erpSkuId", "saleDate", "quantity", "salesAmount", "costAmount", "profitAmount",
  "incomeAmount", "refundAmount", "returnAmount", "postageIncomeAmount", "goodsCostAmount", "returnCostAmount",
  "postageCostAmount", "otherAdjustmentAmount", "feeAmount", "receivedAmount", "factType",
];

function sameFactValue(left, right) {
  return DAILY_FACT_VALUE_FIELDS.every((field) => {
    const a = left[field] === undefined ? null : left[field]; const b = right[field] === undefined ? null : right[field];
    if (a === null || b === null) return a === b;
    if (typeof a === "number" || typeof b === "number") return Math.abs(Number(a) - Number(b)) < 1e-9;
    return String(a) === String(b);
  });
}

function dailyFactFromClassified(item, batchId, createdAt) {
  const data = item.normalized; const result = item.result;
  return {
    id: makeId("sales-daily-fact"), salesLinkId: result.link.id, salesLinkSkuId: result.salesLinkSku.id,
    erpSkuId: result.erpSku.id, saleDate: data.saleDate, quantity: data.quantity, salesAmount: data.salesAmount,
    costAmount: data.costAmount, profitAmount: data.profitAmount, incomeAmount: data.incomeAmount,
    refundAmount: data.refundAmount, returnAmount: data.returnAmount, postageIncomeAmount: data.postageIncomeAmount,
    goodsCostAmount: data.goodsCostAmount, returnCostAmount: data.returnCostAmount, postageCostAmount: data.postageCostAmount,
    otherAdjustmentAmount: data.otherAdjustmentAmount, feeAmount: data.feeAmount, receivedAmount: data.receivedAmount,
    factType: result.relationshipShape === "multi_component" ? "combo_component" : "normal",
    sourceBatchId: batchId, sourceRowNumber: item.rowNumber, rawDataJson: JSON.stringify(item.raw || {}),
    createdAt, updatedAt: createdAt,
  };
}

const EXPLICIT_NON_PRODUCT_USAGE_TYPES = new Set([
  "accounting_auxiliary",
  "shipping_adjustment",
  "other_adjustment",
]);

export function isSalesDailyFactEligible(item = {}) {
  const result = item.result || {};
  const usage = result.usage || null;
  const usageBlocked = usage?.conflicts?.length
    || usage?.warnings?.some((warning) => warning?.code === "ERP_SKU_NOT_FOUND")
    || (usage?.isConfirmed === true && usage?.isUsable === true && EXPLICIT_NON_PRODUCT_USAGE_TYPES.has(usage.usageType));
  return result.category === "ready"
    && result.businessClassification === "product_sale"
    && !usageBlocked
    && result.mapping?.erpSkuId === result.erpSku?.id;
}

export function commitSalesDailyFacts(batchId, { confirmedBy = "", database = getDatabase(), failAfterInserts = null } = {}) {
  const id = text(batchId); const reviewer = text(confirmedBy);
  const batch = database.prepare("SELECT * FROM connection_import_batches WHERE id=? AND importType=?").get(id, IMPORT_TYPE);
  if (!batch) throw Object.assign(new Error("销售日报预览不存在。"), { code: "preview_not_found" });
  const previousSummary = parseJson(batch.previewSummaryJson);
  const previouslyCommitted = Boolean(previousSummary.factCommit?.confirmedAt);
  if (!previouslyCommitted && batch.status !== "preview_ready") throw Object.assign(new Error("当前销售日报预览不可确认写入。"), { code: "preview_not_ready" });
  if (!reviewer || !database.prepare("SELECT 1 FROM persons WHERE id=?").get(reviewer)) throw Object.assign(new Error("确认人不存在。"), { code: "reviewer_not_found" });
  const storedRows = database.prepare("SELECT rowNumber,rawDataJson FROM connection_import_rows WHERE batchId=? ORDER BY rowNumber").all(id);
  if (!storedRows.length) throw new Error("销售日报预览没有可确认的原始明细。");
  const cache = { shops: new Map(), links: new Map(), skus: new Map(), erpSkus: new Map(), dailyFactKeys: new Set() };
  const classified = classifySalesDailyPreviewRows(database, storedRows.map((row) => {
    const raw = parseJson(row.rawDataJson); const standard = normalizeSalesDetailLine(raw, { sourceRowNumber: row.rowNumber });
    return { rowNumber: row.rowNumber, raw, standard, normalized: normalizedFromStandard(standard) };
  }), { cache, ignoreExistingDailyFacts: true });
  const createdAt = now(); const blockedCounts = {}; const eligible = [];
  for (const item of classified) {
    const allowed = isSalesDailyFactEligible(item);
    if (allowed) eligible.push(dailyFactFromClassified(item, id, createdAt));
    else {
      const reason = item.result.category;
      blockedCounts[reason] = (blockedCounts[reason] || 0) + 1;
    }
  }
  const existingRows = database.prepare("SELECT * FROM connection_sku_sales_daily_facts").all();
  const existingByKey = new Map(existingRows.map((row) => [`${row.salesLinkSkuId}|${row.erpSkuId}|${row.saleDate}`, row]));
  const inserts = []; const skips = []; const updatePending = [];
  for (const fact of eligible) {
    const existing = existingByKey.get(`${fact.salesLinkSkuId}|${fact.erpSkuId}|${fact.saleDate}`);
    if (!existing) inserts.push(fact);
    else if (sameFactValue(existing, fact)) skips.push({ fact, existingFactId: existing.id });
    else updatePending.push({ sourceRowNumber: fact.sourceRowNumber, existingFactId: existing.id, salesLinkSkuId: fact.salesLinkSkuId, erpSkuId: fact.erpSkuId, saleDate: fact.saleDate, salesAmount: fact.salesAmount, profitAmount: fact.profitAmount, changedFields: DAILY_FACT_VALUE_FIELDS.filter((field) => !sameFactValue({ [field]: existing[field] }, { [field]: fact[field] })) });
  }
  const sum = (rows, field) => rows.reduce((total, row) => total + Number(row[field] || 0), 0);
  const result = {
    insertedCount: inserts.length, skippedCount: skips.length, updatePendingCount: updatePending.length,
    blockedCount: classified.length - eligible.length,
    pendingCount: Object.entries(blockedCounts).filter(([key]) => ["pending_relation", "missing_relation", "unknown"].includes(key)).reduce((total, [, value]) => total + value, 0),
    errorCount: Object.entries(blockedCounts).filter(([key]) => !["pending_relation", "missing_relation", "unknown", "accounting_auxiliary", "shipping_adjustment", "other_adjustment", "excluded"].includes(key)).reduce((total, [, value]) => total + value, 0),
    blockedCounts, eligibleCount: eligible.length,
    eligibleSalesAmount: sum(eligible, "salesAmount"), eligibleProfitAmount: sum(eligible, "profitAmount"),
    insertedSalesAmount: sum(inserts, "salesAmount"), insertedProfitAmount: sum(inserts, "profitAmount"),
    skippedSalesAmount: sum(skips.map((item) => item.fact), "salesAmount"), skippedProfitAmount: sum(skips.map((item) => item.fact), "profitAmount"),
    updatePendingSalesAmount: sum(updatePending, "salesAmount"), updatePendingProfitAmount: sum(updatePending, "profitAmount"),
    updatePending, confirmedBy: reviewer, confirmedAt: createdAt, parserVersion: PARSER_VERSION,
    sourceFileHash: previousSummary.sourceFileHash || batch.fileHash, sourceFileName: batch.fileName,
  };
  if (previouslyCommitted) {
    const repeatedResult = {
      ...result,
      insertedCount: 0,
      insertedSalesAmount: 0,
      insertedProfitAmount: 0,
      skippedCount: skips.length,
      skippedSalesAmount: sum(skips.map((item) => item.fact), "salesAmount"),
      skippedProfitAmount: sum(skips.map((item) => item.fact), "profitAmount"),
      idempotent: inserts.length === 0 && updatePending.length === 0,
    };
    return { batch, result: repeatedResult };
  }
  database.transaction(() => {
    const insert = database.prepare(`INSERT INTO connection_sku_sales_daily_facts
      (id,salesLinkId,salesLinkSkuId,erpSkuId,saleDate,quantity,salesAmount,costAmount,profitAmount,incomeAmount,refundAmount,returnAmount,postageIncomeAmount,goodsCostAmount,returnCostAmount,postageCostAmount,otherAdjustmentAmount,feeAmount,receivedAmount,factType,sourceBatchId,sourceRowNumber,rawDataJson,createdAt,updatedAt)
      VALUES (@id,@salesLinkId,@salesLinkSkuId,@erpSkuId,@saleDate,@quantity,@salesAmount,@costAmount,@profitAmount,@incomeAmount,@refundAmount,@returnAmount,@postageIncomeAmount,@goodsCostAmount,@returnCostAmount,@postageCostAmount,@otherAdjustmentAmount,@feeAmount,@receivedAmount,@factType,@sourceBatchId,@sourceRowNumber,@rawDataJson,@createdAt,@updatedAt)`);
    for (let index = 0; index < inserts.length; index += 1) {
      insert.run(inserts[index]);
      if (Number.isInteger(failAfterInserts) && index + 1 >= failAfterInserts) throw new Error("TEST_TRANSACTION_ROLLBACK");
    }
    const finalStatus = result.pendingCount || result.errorCount || result.updatePendingCount ? "completed_with_exceptions" : "completed";
    const summary = { ...previousSummary, factCommit: result };
    database.prepare("UPDATE connection_import_batches SET status=?,matchedRows=?,pendingRows=?,errorRows=?,completedAt=?,updatedAt=?,previewSummaryJson=? WHERE id=?")
      .run(finalStatus, result.insertedCount + result.skippedCount, result.pendingCount + result.updatePendingCount, result.errorCount, createdAt, createdAt, JSON.stringify(summary), id);
  })();
  if (inserts.length) invalidateProductContributionCache(database);
  return {
    batch: database.prepare("SELECT * FROM connection_import_batches WHERE id=?").get(id),
    result: { ...result, idempotent: inserts.length === 0 && updatePending.length === 0 && skips.length > 0 && skips.length === eligible.length },
  };
}

export { IMPORT_TYPE as SALES_DAILY_PREVIEW_IMPORT_TYPE, PARSER_VERSION as SALES_DAILY_PREVIEW_PARSER_VERSION };
