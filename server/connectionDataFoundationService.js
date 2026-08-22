import crypto from "node:crypto";
import XLSX from "xlsx";
import { getDatabase } from "./db.js";
import { ensureSingleLinkSkuErpMapping, inspectSingleLinkSkuErpMapping, resolveUniqueProductErpSku } from "./linkSkuErpMappingService.js";
import { normalizeUploadedFileName } from "./uploadFileName.js";

export const connectionImportTypes = [
  "platform_link_operations",
  "erp_sales",
  "erp_product_relations",
  "erp_inventory",
];
export const PLATFORM_LINK_OPERATION_PARSER_VERSION = "platform-link-id-date-v4";

const typeDefinitions = {
  platform_link_operations: {
    label: "平台链接经营导入",
    required: ["platformGoodsId", "title", "periodStart", "periodEnd"],
    fields: ["platformGoodsId", "title", "mainImage", "url", "category", "status", "periodStart", "periodEnd", "visitorCount", "viewCount", "clickCount", "favoriteCount", "cartCount", "orderBuyerCount", "payBuyerCount", "conversionRate", "payAmount", "payQuantity", "refundAmount", "competitionScore"],
    requiresTemplate: false,
  },
  erp_sales: {
    label: "ERP真实销售导入",
    required: ["shop", "platformGoodsId", "platformSkuId", "skuCode", "periodStart", "periodEnd"],
    fields: ["platform", "shop", "platformGoodsId", "platformSkuId", "skuCode", "periodStart", "periodEnd", "shippedQuantity", "salesAmount", "costAmount", "profitAmount"],
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

// The former split types remain readable for historical batches/templates, but are no longer user-facing.
const legacyTypeDefinitions = {
  platform_links: { label: "平台链接导入（历史）", required: ["platform", "shop", "platformGoodsId", "title"], fields: ["platform", "shop", "platformGoodsId", "title", "mainImage", "url", "category", "status"] },
  platform_operations: { label: "平台经营数据导入（历史）", required: ["platform", "shop", "platformGoodsId", "periodStart", "periodEnd"], fields: ["platform", "shop", "platformGoodsId", "periodStart", "periodEnd", "visitorCount", "viewCount", "clickCount", "favoriteCount", "cartCount", "conversionRate", "payAmount", "payQuantity"] },
};
const allTypeDefinitions = { ...typeDefinitions, ...legacyTypeDefinitions };

const aliases = {
  platform: ["平台", "platform"], shop: ["店铺", "店铺名称", "shop"],
  platformGoodsId: ["商品ID", "平台货品ID", "SPU", "platformGoodsId"],
  title: ["商品标题", "商品名称", "商品NAME", "SPU名称", "title"], mainImage: ["商品主图", "主图", "mainImage"],
  url: ["商品链接", "链接", "url"], category: ["类目", "一级类目", "一级品类", "category"], status: ["商品状态", "状态", "status"],
  periodStart: ["周期开始", "开始日期", "统计日期", "日期", "时间", "periodStart"], periodEnd: ["周期结束", "结束日期", "统计日期", "日期", "时间", "periodEnd"],
  visitorCount: ["访客", "访客数", "商品访客数", "visitorCount"], viewCount: ["浏览", "浏览量", "商品浏览量", "viewCount"],
  clickCount: ["点击", "点击量", "clickCount"], favoriteCount: ["收藏", "收藏数", "商品收藏人数", "新增加入心愿单人数", "favoriteCount"],
  cartCount: ["加购", "加购数", "商品加购人数", "新增加购人数", "加购客户数", "cartCount"],
  orderBuyerCount: ["下单买家数", "下单客户数", "orderBuyerCount"], payBuyerCount: ["支付买家数", "成交客户数", "payBuyerCount"],
  conversionRate: ["转化率", "支付转化率", "商品支付转化率", "成交转化率", "conversionRate"],
  payAmount: ["支付金额", "成交金额", "销售额", "payAmount"], payQuantity: ["支付件数", "成交商品件数", "销量", "payQuantity"],
  refundAmount: ["成功退款金额", "退款金额（支付时间）", "取消及售后退款金额", "refundAmount"], competitionScore: ["竞争力评分", "competitionScore"],
  skuCode: ["SKU编码", "商家编码", "货号", "skuCode"], platformSkuId: ["平台SKU ID", "平台规格ID", "platformSkuId"],
  specificationName: ["规格", "规格名称", "specificationName"], shippedQuantity: ["发货销量", "发货数量", "销量", "quantity", "shippedQuantity"],
  salesAmount: ["销售金额", "销售额", "salesAmount"], costAmount: ["成本", "成本金额", "costAmount"], profitAmount: ["利润", "profitAmount"],
  businessDate: ["业务日期", "库存日期", "businessDate"], currentStock: ["当前库存", "实际库存", "currentStock"],
  availableStock: ["可售库存", "可用库存", "availableStock"], unitCost: ["单位成本", "成本价", "unitCost"], salesVelocity: ["销售速度", "日均销量", "salesVelocity"],
};
const numericFields = new Set(["visitorCount", "viewCount", "clickCount", "favoriteCount", "cartCount", "orderBuyerCount", "payBuyerCount", "conversionRate", "payAmount", "payQuantity", "refundAmount", "competitionScore", "shippedQuantity", "salesAmount", "costAmount", "profitAmount", "currentStock", "availableStock", "unitCost", "salesVelocity"]);
const dateFields = new Set(["periodStart", "periodEnd", "businessDate"]);

function text(value) { const result = String(value ?? "").trim(); return result === "-" ? "" : result; }
function number(value) { if (text(value) === "") return null; const parsed = Number(String(value).replaceAll(",", "").replace("%", "")); return Number.isFinite(parsed) ? parsed : null; }
function json(value, fallback) { try { return JSON.parse(value || ""); } catch { return fallback; } }
function normalized(value) { return text(value).toLowerCase(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function now() { return new Date().toISOString(); }
function normalizeDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = text(value); const match = raw.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : "";
}
function parseDateRange(value) {
  const matches = [...text(value).matchAll(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/g)].map((match) => `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`);
  return { periodStart: matches[0] || "", periodEnd: matches[1] || matches[0] || "" };
}

function templateRow(row) {
  if (!row) return row;
  return { ...row, fieldMappings: json(row.fieldMappingsJson, {}), requiredFields: json(row.requiredFieldsJson, []), fieldTypes: json(row.fieldTypesJson, {}), matchRules: json(row.matchRulesJson, {}) };
}

function versionRow(database, templateVersionId) {
  if (!text(templateVersionId)) return null;
  const row = database.prepare(`SELECT v.*,t.name AS templateName,t.sourcePlatform,t.dataType,t.status AS templateStatus FROM connection_import_template_versions v JOIN connection_import_templates t ON t.id=v.templateId WHERE v.id=?`).get(text(templateVersionId));
  if (!row) throw new Error("导入模板版本不存在。");
  return templateRow(row);
}

function pickSheet(workbook, matchRules) {
  const exact = text(matchRules.sheetName);
  if (exact && workbook.SheetNames.includes(exact)) return exact;
  const contains = text(matchRules.sheetNameContains);
  if (contains) {
    const name = workbook.SheetNames.find((item) => item.includes(contains));
    if (name) return name;
  }
  const pattern = text(matchRules.sheetNamePattern);
  if (pattern) {
    const expression = new RegExp(pattern);
    const name = workbook.SheetNames.find((item) => expression.test(item));
    if (name) return name;
  }
  return workbook.SheetNames[0];
}

function readWorkbook(buffer, matchRules = {}) {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: true, cellDates: true });
  const sheetName = pickSheet(workbook, matchRules); const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error("文件中没有符合模板规则的工作表。");
  const headerRow = Math.max(1, Number(matchRules.headerRow || 1));
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  const headers = (matrix[headerRow - 1] || []).map(text);
  if (!headers.some(Boolean)) throw new Error(`第${headerRow}行未识别到表头。`);
  const rawRows = matrix.slice(headerRow).filter((row) => row.some((cell) => text(cell) !== "")).map((values, offset) => ({
    rowNumber: headerRow + offset + 1,
    raw: Object.fromEntries(headers.map((header, index) => [header || `__column_${index + 1}`, values[index] ?? ""])),
  }));
  return { sheetName, headers, rawRows };
}

function defaultMapping(headers, fields) {
  const mapping = {};
  for (const field of fields) {
    const header = headers.find((item) => aliases[field]?.some((alias) => normalized(item) === normalized(alias)));
    if (header) mapping[header] = field;
  }
  return mapping;
}

function rowMatchesFilters(raw, filters = []) {
  return filters.every((filter) => {
    const actual = text(raw[filter.field]); const expected = text(filter.value);
    if (filter.operator === "not_equals") return actual !== expected;
    if (filter.operator === "not_empty") return actual !== "";
    if (filter.operator === "equals_any") return (filter.values || []).map(text).includes(actual);
    return actual === expected;
  });
}

function extractPeriods(row, raw, matchRules, sheetName) {
  const rule = matchRules.dateRule || {};
  if (rule.type === "sheet_name") return parseDateRange(sheetName);
  if (rule.field) return parseDateRange(raw[rule.field]);
  const start = normalizeDate(row.periodStart); const end = normalizeDate(row.periodEnd);
  return { periodStart: start, periodEnd: end || start };
}

function normalizeRow(raw, mapping, matchRules, sheetName) {
  const row = { ...(matchRules.fixedFields || {}) };
  for (const [source, target] of Object.entries(mapping)) row[target] = raw[source];
  const period = extractPeriods(row, raw, matchRules, sheetName); row.periodStart = period.periodStart; row.periodEnd = period.periodEnd;
  for (const key of dateFields) if (row[key] !== undefined && !["periodStart", "periodEnd"].includes(key)) row[key] = normalizeDate(row[key]);
  for (const key of numericFields) if (row[key] !== undefined) row[key] = number(row[key]);
  if (row.conversionRate !== null && row.conversionRate !== undefined && row.conversionRate > 1) row.conversionRate /= 100;
  if (matchRules.statusMap && text(row.status)) row.status = matchRules.statusMap[text(row.status)] || row.status;
  return row;
}

function salesFactV2Period(value, endOfDay = false) {
  const date = normalizeDate(value);
  return date ? `${date}T${endOfDay ? "23:59:59" : "00:00:00"}` : "";
}

function platformTemplateConfigs() {
  const businessMapping = {
    "商品ID": "platformGoodsId", "商品名称": "title", "统计日期": "periodStart", "商品状态": "status",
    "商品访客数": "visitorCount", "商品浏览量": "viewCount", "商品收藏人数": "favoriteCount", "商品加购人数": "cartCount",
    "下单买家数": "orderBuyerCount", "支付买家数": "payBuyerCount", "支付件数": "payQuantity", "支付金额": "payAmount",
    "商品支付转化率": "conversionRate", "成功退款金额": "refundAmount", "竞争力评分": "competitionScore",
  };
  return [
    { name: "天猫-点意旗舰店链接经营模板", platform: "tmall", shop: "点意旗舰店", shopLookup: ["点意旗舰店"], mapping: businessMapping, rules: { headerRow: 5, sheetNameContains: "生意参谋平台", dateRule: { type: "field", field: "统计日期" }, statusMap: { 当前在线: "active" } } },
    { name: "淘宝-半然链接经营模板", platform: "taobao", shop: "半然", shopLookup: ["Banran半然", "半然"], mapping: businessMapping, rules: { headerRow: 5, sheetNameContains: "生意参谋平台", dateRule: { type: "field", field: "统计日期" }, statusMap: { 当前在线: "active" } } },
    { name: "小红书-半然链接经营模板", platform: "xiaohongshu", shop: "半然", shopLookup: ["半然-小红书", "半然"], mapping: { "商品ID": "platformGoodsId", "商品NAME": "title", "一级品类": "category", "商品访客数": "visitorCount", "商品浏览量": "viewCount", "新增加入心愿单人数": "favoriteCount", "新增加购人数": "cartCount", "支付买家数": "payBuyerCount", "支付件数": "payQuantity", "支付金额": "payAmount", "支付转化率": "conversionRate", "退款金额（支付时间）": "refundAmount" }, rules: { headerRow: 1, sheetNameContains: "商品明细数据下载", dateRule: { type: "sheet_name" }, rowFilters: [{ field: "经营方式", value: "全部" }, { field: "载体", value: "全部" }] } },
    { name: "京东-点意链接经营模板", platform: "jd", shop: "点意", shopLookup: ["点意旗舰店", "点意"], mapping: { "SPU": "platformGoodsId", "SPU名称": "title", "一级类目": "category", "时间": "periodStart", "商品访客数": "visitorCount", "商品浏览量": "viewCount", "加购客户数": "cartCount", "成交客户数": "payBuyerCount", "成交商品件数": "payQuantity", "成交金额": "payAmount", "成交转化率": "conversionRate", "取消及售后退款金额": "refundAmount" }, rules: { headerRow: 1, sheetNameContains: "商品明细", dateRule: { type: "field", field: "时间" }, rowFilters: [{ field: "SPU", operator: "not_equals", value: "合计" }] } },
  ];
}

const douyinBusinessMapping = {
  "商品ID": "platformGoodsId", "商品名称": "title", "商品标题": "title", "日期": "periodStart", "统计日期": "periodStart",
  "商品访客数": "visitorCount", "商品浏览量": "viewCount", "点击量": "clickCount", "收藏数": "favoriteCount",
  "加购数": "cartCount", "支付买家数": "payBuyerCount", "支付件数": "payQuantity", "支付金额": "payAmount", "支付转化率": "conversionRate",
};

function findShop(database, platform, shopName, candidates = []) {
  const platformNames = { tmall: ["tmall", "天猫"], taobao: ["taobao", "淘宝"], xiaohongshu: ["xiaohongshu", "小红书"], jd: ["jd", "京东"], douyin: ["douyin", "抖音", "抖店"] }[normalized(platform)] || [text(platform)];
  const names = [...new Set([shopName, ...candidates].map(text).filter(Boolean))];
  for (const name of names) {
    const rows = text(platform)
      ? platformNames.flatMap((platformValue) => database.prepare(`SELECT DISTINCT s.* FROM sales_shops s LEFT JOIN sales_shop_aliases a ON a.shopId=s.id
          WHERE LOWER(s.platform)=LOWER(?) AND (LOWER(s.displayName)=LOWER(?) OR LOWER(s.shopName)=LOWER(?) OR LOWER(a.rawName)=LOWER(?))`).all(platformValue, name, name, name))
      : database.prepare(`SELECT DISTINCT s.* FROM sales_shops s LEFT JOIN sales_shop_aliases a ON a.shopId=s.id
          WHERE LOWER(s.displayName)=LOWER(?) OR LOWER(s.shopName)=LOWER(?) OR LOWER(a.rawName)=LOWER(?)`).all(name, name, name);
    const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
    if (unique.length === 1) return unique[0];
  }
  return null;
}

export function ensurePlatformLinkOperationTemplates() {
  const database = getDatabase(); const createdAt = now(); const results = [];
  database.transaction(() => {
    const configs = platformTemplateConfigs();
    for (const shop of database.prepare("SELECT * FROM sales_shops WHERE status='active' AND platform IN ('douyin','抖音','抖店') ORDER BY id").all()) {
      configs.push({
        name: `抖音-${shop.displayName || shop.shopName}链接经营模板`, platform: "douyin", shop: shop.displayName || shop.shopName,
        shopLookup: [shop.id, shop.shopName, shop.displayName].filter(Boolean), mapping: douyinBusinessMapping,
        rules: { headerRow: 1, dateRule: { type: "field", field: "统计日期" }, statusMap: { 在线: "active" } },
      });
    }
    for (const config of configs) {
      let template = database.prepare("SELECT * FROM connection_import_templates WHERE name=? AND dataType='platform_link_operations'").get(config.name);
      if (!template) {
        const templateId = id("connection-import-template"); const versionId = id("connection-import-template-version"); const shop = findShop(database, config.platform, config.shop, config.shopLookup);
        const rules = { ...config.rules, fixedFields: { platform: config.platform, shop: config.shop, shopId: shop?.id || "" }, periodType: "daily" };
        database.prepare(`INSERT INTO connection_import_templates (id,name,sourcePlatform,dataType,currentVersionId,status,createdAt,updatedAt) VALUES (?,?,?,?,?,'active',?,?)`).run(templateId, config.name, config.platform, "platform_link_operations", versionId, createdAt, createdAt);
        database.prepare(`INSERT INTO connection_import_template_versions (id,templateId,version,fieldMappingsJson,requiredFieldsJson,fieldTypesJson,matchRulesJson,changeNote,status,createdAt) VALUES (?,?,?,?,?,?,?,?, 'active',?)`).run(versionId, templateId, 1, JSON.stringify(config.mapping), JSON.stringify(typeDefinitions.platform_link_operations.required), JSON.stringify({ platformGoodsId: "text" }), JSON.stringify(rules), "初始化真实平台链接经营模板", createdAt);
        template = database.prepare("SELECT * FROM connection_import_templates WHERE id=?").get(templateId);
      } else {
        const version = versionRow(database, template.currentVersionId); const rules = version?.matchRules || {}; const shop = findShop(database, config.platform, config.shop, config.shopLookup);
        if (shop && !text(rules.fixedFields?.shopId)) {
          database.prepare("UPDATE connection_import_template_versions SET matchRulesJson=? WHERE id=?").run(JSON.stringify({ ...rules, fixedFields: { ...(rules.fixedFields || {}), platform: config.platform, shop: config.shop, shopId: shop.id } }), version.id);
        }
      }
      results.push(template.id);
    }
  })();
  return results;
}

export function getConnectionImportDefinitions() { return typeDefinitions; }

export function listConnectionImportTemplates() {
  ensurePlatformLinkOperationTemplates();
  return getDatabase().prepare(`SELECT t.*,v.version,v.fieldMappingsJson,v.requiredFieldsJson,v.fieldTypesJson,v.matchRulesJson,v.changeNote FROM connection_import_templates t LEFT JOIN connection_import_template_versions v ON v.id=t.currentVersionId ORDER BY CASE WHEN t.dataType='platform_link_operations' THEN 0 ELSE 1 END,t.updatedAt DESC,t.id DESC`).all().map(templateRow);
}

function platformLinkParserConfigs() {
  const configs = [...platformTemplateConfigs(), {
    name: "抖音链接经营格式",
    platform: "douyin",
    mapping: douyinBusinessMapping,
    rules: { headerRow: 1, dateRule: { type: "field", field: "统计日期" }, statusMap: { 在线: "active" } },
  }];
  const unique = new Map();
  for (const config of configs) {
    const rules = { ...config.rules };
    delete rules.fixedFields;
    const signature = JSON.stringify({ mapping: config.mapping, rules });
    if (!unique.has(signature)) {
      unique.set(signature, {
        id: null,
        dataType: "platform_link_operations",
        templateName: ["tmall", "taobao"].includes(config.platform) ? "生意参谋链接经营格式" : `${config.platform}链接经营格式`,
        fieldMappings: config.mapping,
        matchRules: { ...rules, fixedFields: {}, periodType: "daily" },
      });
    }
  }
  return [...unique.values()];
}

function detectPlatformLinkFormat(buffer) {
  const candidates = platformLinkParserConfigs();
  const ranked = [];
  for (const candidate of candidates) {
    const rules = candidate.matchRules || {};
    let workbook;
    try { workbook = readWorkbook(buffer, rules); } catch { continue; }
    if (rules.sheetName && workbook.sheetName !== rules.sheetName) continue;
    if (rules.sheetNameContains && !workbook.sheetName.includes(rules.sheetNameContains)) continue;
    if (rules.sheetNamePattern && !(new RegExp(rules.sheetNamePattern)).test(workbook.sheetName)) continue;
    const mapping = candidate.fieldMappings || {};
    const availableTargets = new Set(Object.entries(mapping).filter(([source]) => workbook.headers.includes(source)).map(([, target]) => target));
    if (!availableTargets.has("platformGoodsId") || !availableTargets.has("title")) continue;
    const dateRule = rules.dateRule || {};
    if (dateRule.type !== "sheet_name" && dateRule.field && !workbook.headers.includes(dateRule.field)) continue;
    const goodsHeader = Object.entries(mapping).find(([, target]) => target === "platformGoodsId")?.[0];
    const goodsIds = [...new Set(workbook.rawRows.slice(0, 500).map((item) => text(item.raw[goodsHeader])).filter(Boolean))];
    const score = availableTargets.size + Math.min(goodsIds.length, 500) / 1000;
    ranked.push({ candidate, score });
  }
  ranked.sort((left, right) => right.score - left.score);
  if (!ranked.length) throw new Error("无法识别平台链接经营文件格式，请确认表头、工作表和日期字段是否完整。");
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) throw new Error("文件同时匹配多种平台文件格式，请检查表头是否被修改。");
  return ranked[0].candidate;
}

export function createConnectionImportTemplate(input, userId) {
  const dataType = text(input?.dataType); const name = text(input?.name); const definition = typeDefinitions[dataType];
  if (!definition) throw new Error("导入数据类型无效。");
  if (!name) throw new Error("请填写模板名称。");
  const database = getDatabase(); const createdAt = now(); const templateId = id("connection-import-template"); const versionId = id("connection-import-template-version");
  database.transaction(() => {
    database.prepare(`INSERT INTO connection_import_templates (id,name,sourcePlatform,dataType,currentVersionId,status,createdBy,createdAt,updatedAt) VALUES (?,?,?,?,?,'active',?,?,?)`).run(templateId, name, text(input?.sourcePlatform), dataType, versionId, text(userId) || null, createdAt, createdAt);
    database.prepare(`INSERT INTO connection_import_template_versions (id,templateId,version,fieldMappingsJson,requiredFieldsJson,fieldTypesJson,matchRulesJson,changeNote,status,createdBy,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(versionId, templateId, 1, JSON.stringify(input?.fieldMappings ?? {}), JSON.stringify(definition.required), JSON.stringify(input?.fieldTypes ?? {}), JSON.stringify(input?.matchRules ?? {}), text(input?.changeNote), "active", text(userId) || null, createdAt);
  })();
  return listConnectionImportTemplates().find((item) => item.id === templateId);
}

export function iterateConnectionImportTemplate(templateId, input, userId) {
  const database = getDatabase(); const template = database.prepare("SELECT * FROM connection_import_templates WHERE id=?").get(text(templateId));
  if (!template) throw new Error("导入模板不存在。");
  const current = database.prepare("SELECT * FROM connection_import_template_versions WHERE id=?").get(template.currentVersionId); const versionId = id("connection-import-template-version"); const createdAt = now();
  database.transaction(() => {
    database.prepare("UPDATE connection_import_template_versions SET status='superseded' WHERE templateId=? AND status='active'").run(template.id);
    database.prepare(`INSERT INTO connection_import_template_versions (id,templateId,version,fieldMappingsJson,requiredFieldsJson,fieldTypesJson,matchRulesJson,changeNote,status,createdBy,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(versionId, template.id, Number(current?.version || 0) + 1, JSON.stringify(input?.fieldMappings ?? json(current?.fieldMappingsJson, {})), current.requiredFieldsJson, JSON.stringify(input?.fieldTypes ?? json(current.fieldTypesJson, {})), JSON.stringify(input?.matchRules ?? json(current.matchRulesJson, {})), text(input?.changeNote), "active", text(userId) || null, createdAt);
    database.prepare("UPDATE connection_import_templates SET currentVersionId=?,updatedAt=? WHERE id=?").run(versionId, createdAt, template.id);
  })();
  return listConnectionImportTemplates().find((item) => item.id === template.id);
}

function ensureShop(database, platform, shopName, configuredShopId = "") {
  const selected = text(configuredShopId) ? database.prepare("SELECT * FROM sales_shops WHERE id=?").get(text(configuredShopId)) : findShop(database, text(platform), text(shopName));
  if (selected) return selected;
  throw Object.assign(new Error("未识别店铺，请进入管理员店铺治理确认店铺名称或别名。"), { type: "missing_shop" });
}

function findLink(database, row) {
  const shop = ensureShop(database, row.platform, row.shop, row.shopId);
  return database.prepare("SELECT * FROM sales_links WHERE shopId=? AND platformGoodsId=?").get(shop.id, text(row.platformGoodsId)) || null;
}

function findPlatformOperationLink(database, row) {
  const links = database.prepare(`SELECT l.*,s.platform AS resolvedPlatform,s.shopName AS resolvedShopName,s.displayName AS resolvedShopDisplayName
    FROM sales_links l JOIN sales_shops s ON s.id=l.shopId
    WHERE l.platformGoodsId=? AND l.currentState='active'`).all(text(row.platformGoodsId));
  if (links.length > 1) throw Object.assign(new Error("链接ID对应多个生效链接，无法安全定位经营数据。"), { type: "link_identity_conflict" });
  const link = links[0] || null;
  if (link) {
    row.platform = text(link.resolvedPlatform);
    row.shopId = text(link.shopId);
    row.shop = text(link.resolvedShopDisplayName || link.resolvedShopName);
  }
  return link;
}

function isolateMinorityShopRows(rows) {
  const validRows = rows.filter((item) => item.status === "validated" && text(item.data.shopId));
  const counts = new Map();
  for (const item of validRows) counts.set(item.data.shopId, (counts.get(item.data.shopId) || 0) + 1);
  if (counts.size <= 1 || validRows.length < 5) return null;
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  const [dominantShopId, dominantCount] = ranked[0];
  const confidence = dominantCount / validRows.length;
  if (confidence < 0.9) return null;
  const dominant = validRows.find((item) => item.data.shopId === dominantShopId)?.data;
  let isolatedRows = 0;
  for (const item of validRows) {
    if (item.data.shopId === dominantShopId) continue;
    isolatedRows += 1;
    Object.assign(item, {
      status: "error",
      errorType: "link_shop_mismatch",
      errorMessage: `链接ID当前登记店铺“${text(item.data.shop) || "未知"}”与文件主店铺“${text(dominant?.shop) || "未知"}”不一致，已单行隔离。`,
    });
  }
  return { shopId: dominantShopId, shop: text(dominant?.shop), confidence, isolatedRows };
}

function ensureLink(database, row, batchId, resolvedLink = null) {
  const shop = resolvedLink
    ? database.prepare("SELECT * FROM sales_shops WHERE id=?").get(resolvedLink.shopId)
    : ensureShop(database, row.platform, row.shop, row.shopId);
  let link = resolvedLink || database.prepare("SELECT * FROM sales_links WHERE shopId=? AND platformGoodsId=?").get(shop.id, text(row.platformGoodsId));
  if (!link) throw Object.assign(new Error("平台经营数据未匹配到已有链接，请先通过平台货品导入建立链接身份。"), { type: "missing_link" });
  const createdAt = now();
  // 经营数据只补充经营展示信息，不得覆盖平台货品资产批次身份。
  database.prepare(`UPDATE sales_links SET title=COALESCE(NULLIF(?,''),title),canonicalUrl=COALESCE(NULLIF(?,''),canonicalUrl),rawUrl=COALESCE(NULLIF(?,''),rawUrl),category=COALESCE(NULLIF(?,''),category),status=COALESCE(NULLIF(?,''),status),updatedAt=? WHERE id=?`).run(text(row.title), text(row.url), text(row.url), text(row.category), text(row.status), createdAt, link.id);
  link = database.prepare("SELECT * FROM sales_links WHERE id=?").get(link.id);
  database.prepare(`UPDATE sales_links SET
    displayName=COALESCE(NULLIF(?,''),displayName,title,platformGoodsId),
    mainImage=CASE WHEN COALESCE(mainImage,'')='' THEN NULLIF(?,'') ELSE mainImage END,
    imageSource=CASE WHEN COALESCE(mainImage,'')='' AND ?<>'' THEN 'platform_link_operations' ELSE imageSource END,
    managementOriginSource=CASE WHEN managementOriginSource='asset_native' THEN 'platform_link_operations' ELSE managementOriginSource END,
    managementOriginImportBatchId=COALESCE(managementOriginImportBatchId,?),
    managementIdentifiedAt=COALESCE(managementIdentifiedAt,?),updatedAt=? WHERE id=?`)
    .run(text(row.title), text(row.mainImage), text(row.mainImage), batchId, createdAt, createdAt, link.id);
  const profile = database.prepare("SELECT * FROM connection_profiles WHERE id=?").get(link.id);
  return { link, profile, created: false };
}

function ensurePlatformMapping(database, row, link, profile, raw) {
  let mapping = database.prepare("SELECT * FROM connection_data_mappings WHERE sourceType='platform_operation' AND externalId=? AND externalShopId=? AND deletedAt IS NULL").get(text(row.platformGoodsId), link.shopId);
  if (!mapping) {
    const mappingId = id("connection-mapping"); const createdAt = now();
    database.prepare(`INSERT INTO connection_data_mappings (id,sourceType,connectionId,salesLinkId,externalType,externalId,externalShopId,externalDataJson,matchStatus,matchMethod,confirmedAt,createdAt,updatedAt) VALUES (?,'platform_operation',?,?,'product',?,?,?,'matched','goods_id',?,?,?)`).run(mappingId, profile.id, link.id, text(row.platformGoodsId), link.shopId, JSON.stringify(raw), createdAt, createdAt, createdAt);
    mapping = database.prepare("SELECT * FROM connection_data_mappings WHERE id=?").get(mappingId);
  } else if (mapping.salesLinkId !== link.id || (mapping.connectionId && mapping.connectionId !== profile.id)) throw Object.assign(new Error("商品ID已关联其他链接，禁止覆盖。"), { type: "identity_conflict" });
  return mapping;
}

function insertPlatformSnapshot(database, row, raw, batchId, link, profile, mapping) {
  const before = database.prepare("SELECT id FROM connection_period_snapshots WHERE sourceType='platform_operation' AND salesLinkId=? AND periodStart=? AND periodEnd=?").get(link.id, row.periodStart, row.periodEnd);
  if (before) return false;
  database.prepare(`INSERT INTO connection_period_snapshots (id,connectionId,salesLinkId,mappingId,importBatchId,sourceType,externalId,externalDataJson,periodStart,periodEnd,periodType,visitorCount,viewCount,cartCount,orderBuyerCount,payBuyerCount,conversionRate,payAmount,payQuantity,refundAmount,competitionScore,metricsJson,createdAt) VALUES (?,?,?,?,?,'platform_operation',?,?,?,?,'daily',?,?,?,?,?,?,?,?,?,?,?,?)`).run(id("connection-period"), profile.id, link.id, mapping.id, batchId, text(row.platformGoodsId), JSON.stringify(raw), text(row.periodStart), text(row.periodEnd), row.visitorCount, row.viewCount, row.cartCount, row.orderBuyerCount, row.payBuyerCount, row.conversionRate, row.payAmount, row.payQuantity, row.refundAmount, row.competitionScore, JSON.stringify({ clickCount: row.clickCount, favoriteCount: row.favoriteCount }), now());
  return true;
}

function findLinkSku(database, linkId, skuCode) { return database.prepare("SELECT * FROM sales_link_skus WHERE salesLinkId=? AND LOWER(COALESCE(normalizedPlatformSkuCode,platformSkuCode,''))=LOWER(?)").get(linkId, text(skuCode)); }
function findLinkSkuByPlatformId(database, linkId, platformSkuId) { return database.prepare("SELECT * FROM sales_link_skus WHERE salesLinkId=? AND platformSkuId=?").get(linkId, text(platformSkuId)); }
function requireLink(database, row) { const link = findLink(database, row); if (!link) throw Object.assign(new Error("商品ID不存在。"), { type: "missing_goods_id" }); return link; }
function requireLinkSku(database, link, skuCode) { const sku = findLinkSku(database, link.id, skuCode); if (!sku) throw Object.assign(new Error("SKU不存在。"), { type: "missing_sku" }); return sku; }

function applyRow(database, importType, row, batchId, raw) {
  const createdAt = now();
  if (importType === "platform_link_operations") {
    const resolvedLink = findPlatformOperationLink(database, row);
    if (!resolvedLink) throw Object.assign(new Error("平台经营数据未匹配到已有链接，请先通过平台货品导入建立链接身份。"), { type: "missing_link" });
    const relation = ensureLink(database, row, batchId, resolvedLink); const mapping = ensurePlatformMapping(database, row, relation.link, relation.profile, raw); const factCreated = insertPlatformSnapshot(database, row, raw, batchId, relation.link, relation.profile, mapping);
    return { ...relation, factCreated };
  }
  if (importType === "platform_links") return ensureLink(database, row, batchId);
  if (importType === "platform_operations") {
    const link = requireLink(database, row); const profile = database.prepare("SELECT * FROM connection_profiles WHERE salesLinkId=?").get(link.id); if (!profile) throw Object.assign(new Error("链接档案不存在。"), { type: "missing_connection_profile" }); const mapping = ensurePlatformMapping(database, row, link, profile, raw); insertPlatformSnapshot(database, row, raw, batchId, link, profile, mapping); return { link, profile };
  }
  if (importType === "erp_sales") {
    throw Object.assign(new Error("旧周期销售事实已进入只读状态，请使用销售日报导入。"), { code: "legacy_read_only", type: "legacy_read_only" });
  }
  if (importType === "erp_product_relations") {
    const link = requireLink(database, row);
    const product = database.prepare("SELECT * FROM products WHERE LOWER(skuCode)=LOWER(?)").get(text(row.skuCode));
    if (!product) throw Object.assign(new Error("SKU不存在对应产品。"), { type: "missing_sku" });
    const resolution = resolveUniqueProductErpSku(database, product.id);
    if (resolution.status !== "ready") throw Object.assign(new Error("产品无法唯一确定ERP SKU，已进入V2关系治理。"), { type: "erp_relation_governance_pending" });
    const sku = findLinkSku(database, link.id, row.skuCode);
    if (!sku) throw Object.assign(new Error("ERP关系导入未匹配到已有链接SKU，请先通过平台货品导入建立SKU身份。"), { type: "missing_sku" });
    const relation = ensureSingleLinkSkuErpMapping(database, { salesLinkSkuId: sku.id, erpSkuId: resolution.erpSku.erpSkuId, sourceType: "erp_product_relations", sourceBatchId: batchId, timestamp: createdAt });
    const pending = relation.outcome === "governance_pending";
    database.prepare("UPDATE sales_link_skus SET matchStatus=?,matchMethod='product_structure_application',matchReason=?,updatedAt=? WHERE id=?")
      .run(pending ? "pending_relation" : "erp_linked", pending ? relation.reason : "ERP产品关系与已审核Product Structure一致", createdAt, sku.id);
    return { link, product, sku, mapping: relation.mapping || null, governancePending: pending, applicationBatchId: relation.applicationBatchId || null };
  }
  if (importType === "erp_inventory") {
    const skus = database.prepare("SELECT * FROM sales_link_skus WHERE LOWER(COALESCE(normalizedPlatformSkuCode,platformSkuCode,''))=LOWER(?)").all(text(row.skuCode)); if (!skus.length) throw Object.assign(new Error("SKU不存在。"), { type: "missing_sku" });
    for (const sku of skus) database.prepare(`INSERT OR IGNORE INTO connection_sku_inventory_facts (id,batchId,salesLinkSkuId,skuCode,businessDate,currentStock,availableStock,unitCost,salesVelocity,rawDataJson,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id("connection-sku-inventory"), batchId, sku.id, text(row.skuCode), text(row.businessDate), row.currentStock, row.availableStock, row.unitCost, row.salesVelocity, JSON.stringify(raw), createdAt); return { skus };
  }
  throw new Error("导入类型无效。");
}

function previewSummary(database, rows, importType) {
  let createLinks = 0; let updateLinks = 0; let facts = 0;
  if (importType === "platform_link_operations") for (const item of rows.filter((row) => row.status === "validated")) {
    const link = findPlatformOperationLink(database, item.data); if (link) updateLinks += 1; else createLinks += 1; facts += 1;
  }
  return { createLinks, updateLinks, facts };
}

export function previewConnectionDataImport({ buffer, fileName, importType, templateVersionId, userId, parserVersion = "" }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("请选择Excel文件。");
  const definition = typeDefinitions[text(importType)]; if (!definition) throw new Error("导入类型无效。");
  const effectiveParserVersion = importType === "platform_link_operations" ? PLATFORM_LINK_OPERATION_PARSER_VERSION : text(parserVersion);
  const database = getDatabase(); const sourceFileHash = crypto.createHash("sha256").update(buffer).digest("hex");
  const hash = effectiveParserVersion ? crypto.createHash("sha256").update(buffer).update(`\0${effectiveParserVersion}`).digest("hex") : sourceFileHash;
  const existing = database.prepare("SELECT * FROM connection_import_batches WHERE importType=? AND fileHash=? ORDER BY createdAt DESC").all(importType, hash)
    .find((item) => text(json(item.previewSummaryJson, {}).parserVersion) === effectiveParserVersion);
  if (existing) return { batch: existing, preview: json(existing.previewSummaryJson, {}), rows: listConnectionFoundationRows(existing.id), idempotent: true, blocked: existing.status === "blocked" };
  const version = importType === "platform_link_operations"
    ? detectPlatformLinkFormat(buffer)
    : text(templateVersionId) ? versionRow(database, templateVersionId) : null;
  if (definition.requiresTemplate && !version) throw new Error("未识别到平台链接经营导入模板。");
  if (version && version.dataType !== importType) throw new Error("模板与导入类型不匹配。");
  const matchRules = version?.matchRules || {}; const workbook = readWorkbook(buffer, matchRules); const mapping = version?.fieldMappings || defaultMapping(workbook.headers, definition.fields);
  const filtered = workbook.rawRows.filter((item) => rowMatchesFilters(item.raw, matchRules.rowFilters || []));
  const isSalesFactParser = importType === "erp_sales" && /^sales-fact-v\d/.test(text(parserVersion));
  const normalizedRows = filtered.map((item) => {
    const data = normalizeRow(item.raw, mapping, matchRules, workbook.sheetName);
    if (isSalesFactParser) {
      const businessDate = item.raw["日期"] ?? data.periodStart ?? data.periodEnd;
      data.periodStart = salesFactV2Period(businessDate);
      data.periodEnd = salesFactV2Period(businessDate, true);
    }
    return { ...item, data, status: "validated", errorType: null, errorMessage: null };
  });
  const rows = normalizedRows.filter((item) => !(isSalesFactParser
    && (/^合计[:：]?$/.test(text(item.data.shop)) || normalized(item.data.platformGoodsId) === "na")));
  for (const item of rows) {
    const missing = definition.required.filter((field) => text(item.data[field]) === "");
    const invalidNumbers = Object.entries(mapping).filter(([source, target]) => numericFields.has(target) && text(item.raw[source]) !== "" && item.data[target] === null).map(([, target]) => target);
    if (missing.length) Object.assign(item, { status: "error", errorType: missing.some((field) => dateFields.has(field)) ? "missing_period" : "missing_field", errorMessage: `缺少必填字段：${missing.join("、")}` });
    else if (invalidNumbers.length) Object.assign(item, { status: "error", errorType: "invalid_format", errorMessage: `数值格式错误：${invalidNumbers.join("、")}` });
    else if (importType === "erp_product_relations") {
      const product = database.prepare("SELECT id FROM products WHERE LOWER(skuCode)=LOWER(?)").get(text(item.data.skuCode));
      if (!product) Object.assign(item, { status: "error", errorType: "missing_sku", errorMessage: "SKU不存在对应产品。" });
      else {
        let link = null;
        try { link = findLink(database, item.data); }
        catch (error) { Object.assign(item, { status: "error", errorType: error.type || "missing_shop", errorMessage: error.message }); }
        const sku = link ? findLinkSku(database, link.id, item.data.skuCode) : null;
        if (item.status === "validated" && !link) Object.assign(item, { status: "error", errorType: "missing_link", errorMessage: "ERP关系导入未匹配到已有链接。" });
        if (item.status === "validated" && !sku) Object.assign(item, { status: "error", errorType: "missing_sku", errorMessage: "ERP关系导入未匹配到已有链接SKU，请先导入平台货品。" });
        const resolution = resolveUniqueProductErpSku(database, product.id);
        let governanceReason = resolution.status === "missing" ? "产品没有active ERP SKU映射，无法建立V2关系。" : resolution.status === "multiple" ? "产品对应多个ERP SKU，无法自动确定single关系。" : "";
        if (item.status === "validated" && !governanceReason) {
          const inspection = inspectSingleLinkSkuErpMapping(database, sku.id, resolution.erpSku.erpSkuId);
          if (!["missing", "active_exact"].includes(inspection.status)) governanceReason = inspection.reason;
        }
        if (item.status === "validated" && governanceReason) Object.assign(item, {
          status: "pending_relation",
          errorType: "erp_relation_governance_pending",
          errorMessage: governanceReason,
          governanceCandidates: resolution.candidates,
          governanceProductId: product.id,
        });
      }
    }
    else if (["platform_link_operations", "platform_links", "platform_operations"].includes(importType)) {
      try {
        const link = importType === "platform_link_operations"
          ? findPlatformOperationLink(database, item.data)
          : findLink(database, item.data);
        if (!link) Object.assign(item, { status: "error", errorType: "missing_link", errorMessage: "平台经营数据未匹配到已有链接，请先导入平台货品。" });
      } catch (error) {
        Object.assign(item, { status: "error", errorType: error.type || "missing_shop", errorMessage: error.message });
      }
    }
  }
  const inferredFileShop = importType === "platform_link_operations" ? isolateMinorityShopRows(rows) : null;
  const duplicateKey = (data) => importType === "erp_sales"
    ? [data.shop, data.platformGoodsId, data.platformSkuId, data.skuCode, data.periodStart, data.periodEnd].map(text).join("|")
    : importType === "platform_link_operations"
      ? [data.platformGoodsId, data.periodStart, data.periodEnd].map(text).join("|")
    : text(data.platformGoodsId);
  const duplicateKeys = new Set(); const seen = new Set();
  for (const item of rows.filter((row) => row.status === "validated")) { const key = duplicateKey(item.data); if (seen.has(key)) duplicateKeys.add(key); seen.add(key); }
  for (const item of rows.filter((row) => duplicateKeys.has(duplicateKey(row.data)))) Object.assign(item, { status: "error", errorType: "duplicate_identity", errorMessage: importType === "erp_sales" ? "同一平台SKU、ERP SKU及周期存在重复销售数据，已隔离。" : importType === "platform_link_operations" ? "同一链接ID及数据日期存在重复，已阻断本批次确认。" : "过滤后同一商品ID存在重复，已阻断本批次确认。" });
  const counts = previewSummary(database, rows, importType); const errorRows = rows.filter((item) => item.status === "error").length; const governanceRows = rows.filter((item) => item.status === "pending_relation").length; const validRows = rows.filter((item) => item.status === "validated").length;
  const periods = [...new Set(rows.filter((item) => item.status === "validated").map((item) => `${item.data.periodStart}|${item.data.periodEnd}`))];
  const periodStarts = periods.map((item) => item.split("|")[0]).filter(Boolean).sort();
  const periodEnds = periods.map((item) => item.split("|")[1]).filter(Boolean).sort();
  const previewPeriodStart = isSalesFactParser ? periodStarts[0] || "" : periods.length === 1 ? periodStarts[0] : "";
  const previewPeriodEnd = isSalesFactParser ? periodEnds.at(-1) || "" : periods.length === 1 ? periodEnds[0] : "";
  const resolvedPlatforms = [...new Set(rows.filter((item) => item.status === "validated").map((item) => text(item.data.platform)).filter(Boolean))];
  const resolvedShopIds = [...new Set(rows.filter((item) => item.status === "validated").map((item) => text(item.data.shopId)).filter(Boolean))];
  const resolvedShops = [...new Set(rows.filter((item) => item.status === "validated").map((item) => text(item.data.shop)).filter(Boolean))];
  const preview = { parserVersion: effectiveParserVersion, sourceFileHash, templateName: version?.templateName || "自动字段映射", detectedAutomatically: importType === "platform_link_operations", platform: resolvedPlatforms.length === 1 ? resolvedPlatforms[0] : resolvedPlatforms.length > 1 ? "mixed" : "", shopId: resolvedShopIds.length === 1 ? resolvedShopIds[0] : "", shop: resolvedShops.length === 1 ? resolvedShops[0] : resolvedShops.length > 1 ? "多店铺" : "", resolvedShopCount: resolvedShopIds.length, shopInference: inferredFileShop, sheetName: workbook.sheetName, periodStart: previewPeriodStart, periodEnd: previewPeriodEnd, rawRows: workbook.rawRows.length, filteredRows: rows.length, ignoredSummaryRows: normalizedRows.length - rows.length, newLinks: counts.createLinks, updatedLinks: counts.updateLinks, operationFacts: counts.facts, errors: errorRows, governancePending: governanceRows, duplicateGoodsIds: [...new Set([...duplicateKeys].map((key) => key.split("|")[0]))] };
  const batchId = id("connection-import"); const createdAt = now(); const batchStatus = duplicateKeys.size && !isSalesFactParser ? "blocked" : "validated";
  database.transaction(() => {
    database.prepare(`INSERT INTO connection_import_batches (id,sourceType,externalShopId,fileName,fileHash,businessDate,periodStart,periodEnd,periodType,status,totalRows,matchedRows,pendingRows,errorRows,createdBy,createdAt,updatedAt,importType,templateVersionId,sourcePlatform,previewSummaryJson) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(batchId, importType, preview.shopId || "", text(fileName) || "链接数据.xlsx", hash, preview.periodEnd || createdAt.slice(0, 10), preview.periodStart || null, preview.periodEnd || null, text(matchRules.periodType) || null, batchStatus, rows.length, 0, validRows + governanceRows, errorRows, text(userId) || null, createdAt, createdAt, importType, null, preview.platform, JSON.stringify(preview));
    const insert = database.prepare(`INSERT INTO connection_import_rows (id,batchId,rowNumber,externalKey,rawDataJson,normalizedDataJson,status,errorType,errorMessage,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    for (const item of rows) insert.run(id("connection-import-row"), batchId, item.rowNumber, text(item.data.platformGoodsId || item.data.skuCode), JSON.stringify(item.raw), JSON.stringify(item.data), item.status, item.errorType, item.errorMessage, createdAt);
    const insertCandidate = database.prepare(`INSERT OR IGNORE INTO sales_link_sku_erp_mapping_candidates
      (id,salesLinkSkuId,erpSkuId,candidateType,suggestedQuantity,sourceType,sourceBatchId,sourceFileHash,sourceRowNumber,evidenceJson,affectedRowCount,status,createdAt,updatedAt)
      VALUES (?,?,?,'single',1,'erp_product_relations',?,?,?,?,1,'pending',?,?)`);
    for (const item of rows.filter((row) => row.status === "pending_relation" && row.governanceCandidates?.length)) {
      const link = findLink(database, item.data);
      const sku = link ? findLinkSku(database, link.id, item.data.skuCode) : null;
      if (!sku) continue;
      for (const candidate of item.governanceCandidates) insertCandidate.run(
        id("sales-relation-candidate"), sku.id, candidate.erpSkuId, batchId, sourceFileHash, item.rowNumber,
        JSON.stringify({ reason: item.errorMessage, productId: item.governanceProductId, source: { fileName, rowNumber: item.rowNumber } }), createdAt, createdAt,
      );
    }
  })();
  return { batch: readConnectionFoundationBatch(batchId), preview, rows: listConnectionFoundationRows(batchId), idempotent: false, blocked: batchStatus === "blocked" };
}

export function confirmConnectionDataImport(batchId) {
  const database = getDatabase(); const batch = readConnectionFoundationBatch(batchId);
  if (batch.status === "completed" || batch.status === "completed_with_errors") return { batch, idempotent: true, preview: json(batch.previewSummaryJson, {}) };
  if (batch.importType === "erp_sales") throw Object.assign(new Error("旧周期销售事实已进入只读状态，请按销售日报事实模型重新生成预览。"), { code: "legacy_read_only" });
  if (batch.status !== "validated") throw new Error(batch.status === "blocked" ? "批次存在重复商品ID，不能确认导入。" : "当前批次不能确认导入。");
  const allRows = listConnectionFoundationRows(batch.id); const rows = allRows.filter((row) => row.status === "validated"); const governancePending = allRows.filter((row) => row.status === "pending_relation").length; let createdLinks = 0; let updatedLinks = 0; let factsCreated = 0; let factsUpdated = 0;
  database.transaction(() => {
    for (const item of rows) { const result = applyRow(database, batch.importType, json(item.normalizedDataJson, {}), batch.id, json(item.rawDataJson, {})); if (result.created) createdLinks += 1; else if (result.link) updatedLinks += 1; if (result.factCreated) factsCreated += 1; if (result.factUpdated) factsUpdated += 1; database.prepare("UPDATE connection_import_rows SET status='success' WHERE id=?").run(item.id); }
    const completedAt = now(); database.prepare("UPDATE connection_import_batches SET status=?,matchedRows=?,pendingRows=?,completedAt=?,updatedAt=? WHERE id=?").run(batch.errorRows || governancePending ? "completed_with_errors" : "completed", rows.length, governancePending, completedAt, completedAt, batch.id);
  })();
  return { batch: readConnectionFoundationBatch(batch.id), preview: json(batch.previewSummaryJson, {}), result: { createdLinks, updatedLinks, factsCreated, factsUpdated, governancePending }, idempotent: false };
}

// Backward-compatible internal entry point; callers should prefer preview + confirm.
export function importConnectionData(input) { const preview = previewConnectionDataImport(input); if (preview.idempotent) return preview; return confirmConnectionDataImport(preview.batch.id); }

export function listConnectionFoundationRows(batchId) { return getDatabase().prepare("SELECT * FROM connection_import_rows WHERE batchId=? ORDER BY rowNumber").all(text(batchId)); }
export function listConnectionFoundationBatches() { return getDatabase().prepare("SELECT * FROM connection_import_batches WHERE importType IS NOT NULL ORDER BY createdAt DESC,id DESC LIMIT 100").all().map((row) => ({ ...row, fileName: normalizeUploadedFileName(row.fileName) })); }
export function readConnectionFoundationBatch(batchId) { const row = getDatabase().prepare("SELECT * FROM connection_import_batches WHERE id=? AND importType IS NOT NULL").get(text(batchId)); if (!row) throw new Error("导入记录不存在。"); return { ...row, fileName: normalizeUploadedFileName(row.fileName) }; }
export function listConnectionImportErrors(batchId = "") { return getDatabase().prepare(`SELECT r.*,b.importType,b.fileName FROM connection_import_rows r JOIN connection_import_batches b ON b.id=r.batchId WHERE r.status='error' AND (?='' OR r.batchId=?) ORDER BY r.createdAt DESC,r.rowNumber LIMIT 500`).all(text(batchId), text(batchId)).map((row) => ({ ...row, fileName: normalizeUploadedFileName(row.fileName) })); }
