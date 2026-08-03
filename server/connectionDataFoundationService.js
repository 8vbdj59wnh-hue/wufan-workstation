import crypto from "node:crypto";
import XLSX from "xlsx";
import { getDatabase } from "./db.js";

export const connectionImportTypes = [
  "platform_links",
  "platform_operations",
  "erp_sales",
  "erp_product_relations",
  "erp_inventory",
];

const typeDefinitions = {
  platform_links: {
    label: "平台链接导入",
    required: ["platform", "shop", "platformGoodsId", "title"],
    fields: ["platform", "shop", "platformGoodsId", "title", "mainImage", "url", "category", "status"],
  },
  platform_operations: {
    label: "平台经营数据导入",
    required: ["platform", "shop", "platformGoodsId", "periodStart", "periodEnd"],
    fields: ["platform", "shop", "platformGoodsId", "periodStart", "periodEnd", "visitorCount", "viewCount", "clickCount", "favoriteCount", "cartCount", "conversionRate", "payAmount", "payQuantity"],
  },
  erp_sales: {
    label: "ERP真实销售导入",
    required: ["platform", "shop", "platformGoodsId", "skuCode", "periodStart", "periodEnd"],
    fields: ["platform", "shop", "platformGoodsId", "skuCode", "periodStart", "periodEnd", "shippedQuantity", "salesAmount", "costAmount", "profitAmount"],
  },
  erp_product_relations: {
    label: "ERP产品关系导入",
    required: ["platform", "shop", "platformGoodsId", "skuCode"],
    fields: ["platform", "shop", "platformGoodsId", "platformSkuId", "skuCode", "specificationName"],
  },
  erp_inventory: {
    label: "ERP库存导入",
    required: ["skuCode", "businessDate"],
    fields: ["skuCode", "businessDate", "currentStock", "availableStock", "unitCost", "salesVelocity"],
  },
};

const aliases = {
  platform: ["平台", "platform"], shop: ["店铺", "店铺名称", "shop"],
  platformGoodsId: ["商品ID", "平台货品ID", "SPU", "platformGoodsId"],
  title: ["商品标题", "商品名称", "title"], mainImage: ["商品主图", "主图", "mainImage"],
  url: ["商品链接", "链接", "url"], category: ["类目", "category"], status: ["状态", "status"],
  periodStart: ["周期开始", "开始日期", "periodStart"], periodEnd: ["周期结束", "结束日期", "periodEnd"],
  visitorCount: ["访客", "访客数", "visitorCount"], viewCount: ["浏览", "浏览量", "viewCount"],
  clickCount: ["点击", "点击量", "clickCount"], favoriteCount: ["收藏", "收藏数", "favoriteCount"],
  cartCount: ["加购", "加购数", "cartCount"], conversionRate: ["转化率", "支付转化率", "conversionRate"],
  payAmount: ["支付金额", "销售额", "payAmount"], payQuantity: ["支付件数", "销量", "payQuantity"],
  skuCode: ["SKU编码", "商家编码", "货号", "skuCode"], platformSkuId: ["平台SKU ID", "platformSkuId"],
  specificationName: ["规格", "规格名称", "specificationName"], shippedQuantity: ["发货销量", "发货数量", "shippedQuantity"],
  salesAmount: ["销售金额", "salesAmount"], costAmount: ["成本", "成本金额", "costAmount"],
  profitAmount: ["利润", "profitAmount"], businessDate: ["业务日期", "库存日期", "businessDate"],
  currentStock: ["当前库存", "实际库存", "currentStock"], availableStock: ["可售库存", "可用库存", "availableStock"],
  unitCost: ["单位成本", "成本价", "unitCost"], salesVelocity: ["销售速度", "日均销量", "salesVelocity"],
};
const numericFields = new Set(["visitorCount", "viewCount", "clickCount", "favoriteCount", "cartCount", "conversionRate", "payAmount", "payQuantity", "shippedQuantity", "salesAmount", "costAmount", "profitAmount", "currentStock", "availableStock", "unitCost", "salesVelocity"]);

function text(value) { return String(value ?? "").trim(); }
function number(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(String(value).replaceAll(",", "").replace("%", ""));
  return Number.isFinite(parsed) ? parsed : null;
}
function json(value, fallback) { try { return JSON.parse(value || ""); } catch { return fallback; } }
function normalized(value) { return text(value).toLowerCase(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function now() { return new Date().toISOString(); }
function normalizeDate(value) {
  const raw = text(value); const match = raw.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : raw;
}

function readWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false, cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("文件中没有可读取的工作表。");
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  if (!rows.length) throw new Error("文件中没有数据。");
  return rows;
}

function defaultMapping(headers, fields) {
  const mapping = {};
  for (const field of fields) {
    const match = aliases[field]?.find((alias) => headers.some((header) => normalized(header) === normalized(alias)));
    const header = match && headers.find((item) => normalized(item) === normalized(match));
    if (header) mapping[header] = field;
  }
  return mapping;
}

function normalizeRow(raw, mapping) {
  const row = {};
  for (const [source, target] of Object.entries(mapping)) row[target] = raw[source];
  for (const key of ["periodStart", "periodEnd", "businessDate"]) if (row[key] !== undefined) row[key] = normalizeDate(row[key]);
  for (const key of ["visitorCount", "viewCount", "clickCount", "favoriteCount", "cartCount", "conversionRate", "payAmount", "payQuantity", "shippedQuantity", "salesAmount", "costAmount", "profitAmount", "currentStock", "availableStock", "unitCost", "salesVelocity"]) {
    if (row[key] !== undefined) row[key] = number(row[key]);
  }
  if (row.conversionRate !== null && row.conversionRate !== undefined && row.conversionRate > 1) row.conversionRate /= 100;
  return row;
}

function templateRow(row) {
  if (!row) return row;
  return { ...row, fieldMappings: json(row.fieldMappingsJson, {}), requiredFields: json(row.requiredFieldsJson, []), fieldTypes: json(row.fieldTypesJson, {}), matchRules: json(row.matchRulesJson, {}) };
}

export function getConnectionImportDefinitions() { return typeDefinitions; }

export function listConnectionImportTemplates() {
  return getDatabase().prepare(`
    SELECT t.*,v.version,v.fieldMappingsJson,v.requiredFieldsJson,v.fieldTypesJson,v.matchRulesJson,v.changeNote
    FROM connection_import_templates t LEFT JOIN connection_import_template_versions v ON v.id=t.currentVersionId
    ORDER BY t.updatedAt DESC,t.id DESC
  `).all().map(templateRow);
}

export function createConnectionImportTemplate(input, userId) {
  const dataType = text(input?.dataType); const name = text(input?.name);
  if (!typeDefinitions[dataType]) throw new Error("导入数据类型无效。");
  if (!name) throw new Error("请填写模板名称。");
  const mapping = input?.fieldMappings ?? {};
  const database = getDatabase(); const createdAt = now();
  const create = database.transaction(() => {
    const templateId = id("connection-import-template"); const versionId = id("connection-import-template-version");
    database.prepare(`INSERT INTO connection_import_templates (id,name,sourcePlatform,dataType,currentVersionId,status,createdBy,createdAt,updatedAt) VALUES (?,?,?,?,?,'active',?,?,?)`)
      .run(templateId, name, text(input?.sourcePlatform), dataType, versionId, text(userId) || null, createdAt, createdAt);
    database.prepare(`INSERT INTO connection_import_template_versions (id,templateId,version,fieldMappingsJson,requiredFieldsJson,fieldTypesJson,matchRulesJson,changeNote,status,createdBy,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(versionId, templateId, 1, JSON.stringify(mapping), JSON.stringify(typeDefinitions[dataType].required), JSON.stringify(input?.fieldTypes ?? {}), JSON.stringify(input?.matchRules ?? {}), text(input?.changeNote), "active", text(userId) || null, createdAt);
    return templateId;
  });
  const templateId = create();
  return listConnectionImportTemplates().find((item) => item.id === templateId);
}

export function iterateConnectionImportTemplate(templateId, input, userId) {
  const database = getDatabase(); const template = database.prepare("SELECT * FROM connection_import_templates WHERE id=?").get(text(templateId));
  if (!template) throw new Error("导入模板不存在。");
  const current = database.prepare("SELECT * FROM connection_import_template_versions WHERE id=?").get(template.currentVersionId);
  const version = Number(current?.version || 0) + 1; const versionId = id("connection-import-template-version"); const createdAt = now();
  const fieldMappings = input?.fieldMappings ?? json(current?.fieldMappingsJson, {});
  database.transaction(() => {
    database.prepare("UPDATE connection_import_template_versions SET status='superseded' WHERE templateId=? AND status='active'").run(template.id);
    database.prepare(`INSERT INTO connection_import_template_versions (id,templateId,version,fieldMappingsJson,requiredFieldsJson,fieldTypesJson,matchRulesJson,changeNote,status,createdBy,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(versionId, template.id, version, JSON.stringify(fieldMappings), current.requiredFieldsJson, JSON.stringify(input?.fieldTypes ?? json(current.fieldTypesJson, {})), JSON.stringify(input?.matchRules ?? json(current.matchRulesJson, {})), text(input?.changeNote), "active", text(userId) || null, createdAt);
    database.prepare("UPDATE connection_import_templates SET currentVersionId=?,updatedAt=? WHERE id=?").run(versionId, createdAt, template.id);
  })();
  return listConnectionImportTemplates().find((item) => item.id === template.id);
}

function ensureShop(database, platform, shopName) {
  const platformValue = text(platform); const name = text(shopName);
  let shop = database.prepare("SELECT * FROM sales_shops WHERE LOWER(platform)=LOWER(?) AND (LOWER(displayName)=LOWER(?) OR LOWER(shopName)=LOWER(?))").get(platformValue, name, name);
  if (shop) return shop;
  const shopId = id("sales-shop"); const createdAt = now();
  database.prepare(`INSERT INTO sales_shops (id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt) VALUES (?,?,?,?,?,'active',?,?)`)
    .run(shopId, platformValue, name, normalized(name), name, createdAt, createdAt);
  return database.prepare("SELECT * FROM sales_shops WHERE id=?").get(shopId);
}

function findLink(database, row) {
  const shop = database.prepare("SELECT * FROM sales_shops WHERE LOWER(platform)=LOWER(?) AND (LOWER(displayName)=LOWER(?) OR LOWER(shopName)=LOWER(?))").get(text(row.platform), text(row.shop), text(row.shop));
  if (!shop) return null;
  return database.prepare("SELECT * FROM sales_links WHERE shopId=? AND platformGoodsId=?").get(shop.id, text(row.platformGoodsId));
}

function ensureLink(database, row, batchId) {
  const shop = ensureShop(database, row.platform, row.shop); let link = database.prepare("SELECT * FROM sales_links WHERE shopId=? AND platformGoodsId=?").get(shop.id, text(row.platformGoodsId)); const createdAt = now();
  if (!link) {
    const linkId = id("sales-link");
    database.prepare(`INSERT INTO sales_links (id,shopId,platformGoodsId,platformGoodsCode,title,canonicalUrl,rawUrl,status,activityStatus,category,identityStrength,originSource,enrichmentStatus,lastSeenBatchId,currentState,lastImportedAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,'platform_link_import','complete',?,'active',?,?,?)`)
      .run(linkId, shop.id, text(row.platformGoodsId), text(row.platformGoodsId), text(row.title), text(row.url) || null, text(row.url) || null, text(row.status) || "active", "active", text(row.category), "goods_id", batchId, createdAt, createdAt, createdAt);
    link = database.prepare("SELECT * FROM sales_links WHERE id=?").get(linkId);
  } else {
    database.prepare(`UPDATE sales_links SET title=COALESCE(NULLIF(?,''),title),canonicalUrl=COALESCE(NULLIF(?,''),canonicalUrl),rawUrl=COALESCE(NULLIF(?,''),rawUrl),category=COALESCE(NULLIF(?,''),category),status=COALESCE(NULLIF(?,''),status),lastSeenBatchId=?,lastImportedAt=?,updatedAt=? WHERE id=?`)
      .run(text(row.title), text(row.url), text(row.url), text(row.category), text(row.status), batchId, createdAt, createdAt, link.id);
  }
  let profile = database.prepare("SELECT * FROM connection_profiles WHERE salesLinkId=?").get(link.id);
  if (!profile) {
    const profileId = id("connection");
    database.prepare(`INSERT INTO connection_profiles (id,salesLinkId,name,mainImage,imageSource,status,level,notes,originSource,originImportBatchId,identifiedAt,createdAt,updatedAt) VALUES (?,?,?,?,?,'active','new','','platform_link_import',?,?,?,?)`)
      .run(profileId, link.id, text(row.title) || text(row.platformGoodsId), text(row.mainImage) || null, text(row.mainImage) ? "platform_link_import" : null, batchId, createdAt, createdAt, createdAt);
    profile = database.prepare("SELECT * FROM connection_profiles WHERE id=?").get(profileId);
  } else if (text(row.mainImage) && !profile.mainImage) database.prepare("UPDATE connection_profiles SET mainImage=?,imageSource='platform_link_import',updatedAt=? WHERE id=?").run(text(row.mainImage), createdAt, profile.id);
  return { link, profile };
}

function findLinkSku(database, linkId, skuCode) {
  return database.prepare("SELECT * FROM sales_link_skus WHERE salesLinkId=? AND LOWER(COALESCE(normalizedPlatformSkuCode,platformSkuCode,''))=LOWER(?)").get(linkId, text(skuCode));
}

function requireLink(database, row) {
  const link = findLink(database, row); if (!link) throw Object.assign(new Error("商品ID不存在。"), { type: "missing_goods_id" }); return link;
}

function requireLinkSku(database, link, skuCode) {
  const sku = findLinkSku(database, link.id, skuCode); if (!sku) throw Object.assign(new Error("SKU不存在。"), { type: "missing_sku" }); return sku;
}

function applyRow(database, importType, row, batchId, raw) {
  const createdAt = now();
  if (importType === "platform_links") return ensureLink(database, row, batchId);
  if (importType === "platform_operations") {
    const link = requireLink(database, row); const profile = database.prepare("SELECT * FROM connection_profiles WHERE salesLinkId=?").get(link.id);
    if (!profile) throw Object.assign(new Error("链接档案不存在。"), { type: "missing_connection_profile" });
    let mapping = database.prepare("SELECT * FROM connection_data_mappings WHERE sourceType='platform_operation' AND externalId=? AND externalShopId=? AND deletedAt IS NULL").get(text(row.platformGoodsId), link.shopId);
    if (!mapping) {
      const mappingId = id("connection-mapping"); database.prepare(`INSERT INTO connection_data_mappings (id,sourceType,connectionId,salesLinkId,externalType,externalId,externalShopId,externalDataJson,matchStatus,matchMethod,confirmedAt,createdAt,updatedAt) VALUES (?,'platform_operation',?,?,'product',?,?,?,'matched','goods_id',?,?,?)`)
        .run(mappingId, profile.id, link.id, text(row.platformGoodsId), link.shopId, JSON.stringify({ platform: row.platform, shop: row.shop }), createdAt, createdAt, createdAt);
      mapping = database.prepare("SELECT * FROM connection_data_mappings WHERE id=?").get(mappingId);
    }
    const snapshotId = id("connection-period");
    database.prepare(`INSERT OR IGNORE INTO connection_period_snapshots (id,connectionId,salesLinkId,mappingId,importBatchId,sourceType,externalId,externalDataJson,periodStart,periodEnd,periodType,visitorCount,viewCount,cartCount,conversionRate,payAmount,payQuantity,metricsJson,createdAt) VALUES (?,?,?,?,?,'platform_operation',?,?,?,?,'custom_period',?,?,?,?,?,?,?,?)`)
      .run(snapshotId, profile.id, link.id, mapping.id, batchId, text(row.platformGoodsId), JSON.stringify(raw), text(row.periodStart), text(row.periodEnd), row.visitorCount, row.viewCount, row.cartCount, row.conversionRate, row.payAmount, row.payQuantity, JSON.stringify({ clickCount: row.clickCount, favoriteCount: row.favoriteCount }), createdAt);
    return { link, profile };
  }
  if (importType === "erp_sales") {
    const link = requireLink(database, row); const sku = requireLinkSku(database, link, row.skuCode);
    database.prepare(`INSERT OR IGNORE INTO connection_sku_sales_facts (id,batchId,salesLinkId,salesLinkSkuId,platformGoodsId,skuCode,periodStart,periodEnd,shippedQuantity,salesAmount,costAmount,profitAmount,rawDataJson,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id("connection-sku-sales"), batchId, link.id, sku.id, text(row.platformGoodsId), text(row.skuCode), text(row.periodStart), text(row.periodEnd), row.shippedQuantity, row.salesAmount, row.costAmount, row.profitAmount, JSON.stringify(raw), createdAt);
    return { link, sku };
  }
  if (importType === "erp_product_relations") {
    const link = requireLink(database, row); const product = database.prepare("SELECT * FROM products WHERE LOWER(skuCode)=LOWER(?)").get(text(row.skuCode));
    if (!product) throw Object.assign(new Error("SKU不存在对应产品。"), { type: "missing_sku" });
    let sku = findLinkSku(database, link.id, row.skuCode);
    if (!sku) {
      const skuId = id("sales-link-sku"); database.prepare(`INSERT INTO sales_link_skus (id,salesLinkId,productId,platformSkuId,platformSkuCode,normalizedPlatformSkuCode,specificationName,normalizedSpecificationName,syncEnabled,matchStatus,matchMethod,matchReason,currentState,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,0,'matched_manual','sku','ERP产品关系导入','active',?,?)`)
        .run(skuId, link.id, product.id, text(row.platformSkuId) || null, text(row.skuCode), normalized(row.skuCode), text(row.specificationName), normalized(row.specificationName), createdAt, createdAt);
    } else database.prepare("UPDATE sales_link_skus SET productId=?,matchStatus='matched_manual',matchMethod='sku',matchReason='ERP产品关系导入',updatedAt=? WHERE id=?").run(product.id, createdAt, sku.id);
    return { link, product };
  }
  if (importType === "erp_inventory") {
    const skus = database.prepare("SELECT * FROM sales_link_skus WHERE LOWER(COALESCE(normalizedPlatformSkuCode,platformSkuCode,''))=LOWER(?)").all(text(row.skuCode));
    if (!skus.length) throw Object.assign(new Error("SKU不存在。"), { type: "missing_sku" });
    for (const sku of skus) database.prepare(`INSERT OR IGNORE INTO connection_sku_inventory_facts (id,batchId,salesLinkSkuId,skuCode,businessDate,currentStock,availableStock,unitCost,salesVelocity,rawDataJson,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id("connection-sku-inventory"), batchId, sku.id, text(row.skuCode), text(row.businessDate), row.currentStock, row.availableStock, row.unitCost, row.salesVelocity, JSON.stringify(raw), createdAt);
    return { skus };
  }
  throw new Error("导入类型无效。");
}

export function importConnectionData({ buffer, fileName, importType, templateVersionId, sourcePlatform, userId }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("请选择Excel文件。");
  const definition = typeDefinitions[text(importType)]; if (!definition) throw new Error("导入类型无效。");
  const database = getDatabase(); const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const existing = database.prepare("SELECT * FROM connection_import_batches WHERE importType=? AND fileHash=? ORDER BY createdAt DESC LIMIT 1").get(importType, hash);
  if (existing) return { batch: existing, idempotent: true, errors: listConnectionImportErrors(existing.id) };
  const rawRows = readWorkbook(buffer); const headers = Object.keys(rawRows[0] ?? {});
  const version = templateVersionId ? database.prepare("SELECT * FROM connection_import_template_versions WHERE id=?").get(text(templateVersionId)) : null;
  if (templateVersionId && !version) throw new Error("导入模板版本不存在。");
  const mapping = version ? json(version.fieldMappingsJson, {}) : defaultMapping(headers, definition.fields);
  const batchId = id("connection-import"); const createdAt = now(); const normalizedRows = rawRows.map((raw, index) => ({ raw, rowNumber: index + 2, data: normalizeRow(raw, mapping) }));
  let successCount = 0; let errorCount = 0;
  database.transaction(() => {
    database.prepare(`INSERT INTO connection_import_batches (id,sourceType,externalShopId,fileName,fileHash,businessDate,status,totalRows,matchedRows,pendingRows,errorRows,createdBy,createdAt,updatedAt,importType,templateVersionId,sourcePlatform) VALUES (?,?,?,?,?,?,'processing',?,0,0,0,?,?,?,?,?,?)`)
      .run(batchId, importType, "", text(fileName) || "链接数据.xlsx", hash, createdAt.slice(0, 10), normalizedRows.length, text(userId) || null, createdAt, createdAt, importType, version?.id ?? null, text(sourcePlatform));
    for (const item of normalizedRows) {
      const missing = definition.required.filter((field) => text(item.data[field]) === "");
      const invalidNumbers = Object.entries(mapping).filter(([source, target]) => numericFields.has(target) && text(item.raw[source]) !== "" && item.data[target] === null).map(([, target]) => target);
      let status = "success"; let errorType = null; let errorMessage = null;
      try {
        if (missing.length) throw Object.assign(new Error(`缺少必填字段：${missing.join("、")}`), { type: "missing_field" });
        if (invalidNumbers.length) throw Object.assign(new Error(`数值格式错误：${invalidNumbers.join("、")}`), { type: "invalid_format" });
        applyRow(database, importType, item.data, batchId, item.raw); successCount += 1;
      } catch (error) { status = "error"; errorType = error.type || "invalid_format"; errorMessage = error.message || "数据格式错误。"; errorCount += 1; }
      database.prepare(`INSERT INTO connection_import_rows (id,batchId,rowNumber,externalKey,rawDataJson,normalizedDataJson,status,errorType,errorMessage,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(id("connection-import-row"), batchId, item.rowNumber, text(item.data.platformGoodsId || item.data.skuCode), JSON.stringify(item.raw), JSON.stringify(item.data), status, errorType, errorMessage, createdAt);
    }
    database.prepare("UPDATE connection_import_batches SET status=?,matchedRows=?,errorRows=?,completedAt=?,updatedAt=? WHERE id=?")
      .run(errorCount ? "completed_with_errors" : "completed", successCount, errorCount, createdAt, createdAt, batchId);
  })();
  return { batch: readConnectionFoundationBatch(batchId), idempotent: false, errors: listConnectionImportErrors(batchId) };
}

export function listConnectionFoundationBatches() {
  return getDatabase().prepare("SELECT * FROM connection_import_batches WHERE importType IS NOT NULL ORDER BY createdAt DESC,id DESC LIMIT 100").all();
}
export function readConnectionFoundationBatch(batchId) {
  const row = getDatabase().prepare("SELECT * FROM connection_import_batches WHERE id=? AND importType IS NOT NULL").get(text(batchId));
  if (!row) throw new Error("导入记录不存在。"); return row;
}
export function listConnectionImportErrors(batchId = "") {
  return getDatabase().prepare(`SELECT r.*,b.importType,b.fileName FROM connection_import_rows r JOIN connection_import_batches b ON b.id=r.batchId WHERE r.status='error' AND (?='' OR r.batchId=?) ORDER BY r.createdAt DESC,r.rowNumber LIMIT 500`).all(text(batchId), text(batchId));
}
