import path from "node:path";
import Database from "better-sqlite3";
import { resolveLinkSkuErpRelations } from "../server/capabilities/resolveLinkSkuErpRelation.js";

const source = String(process.env.PRODUCT_LINK_COMPARE_DB_PATH ?? "").trim();
if (!source) throw new Error("请通过 PRODUCT_LINK_COMPARE_DB_PATH 指定只读数据库快照。");
const databasePath = path.resolve(source);
const database = new Database(databasePath, { readonly: true, fileMustExist: true });
const products = database.prepare("SELECT id,skuCode,name FROM products ORDER BY skuCode,id").all();
const productById = new Map(products.map((row) => [row.id, row]));
const add = (map, key, value) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(value); };
const number = (value) => Number(value || 0);

const legacyRows = database.prepare(`
  SELECT id salesLinkSkuId,salesLinkId,productId
  FROM sales_link_skus
  WHERE productId IS NOT NULL AND matchStatus IN ('matched','matched_auto','matched_manual')
`).all();
const legacyLinksByProduct = new Map();
const legacySkusByProductLink = new Map();
const legacyProductBySku = new Map();
for (const row of legacyRows) {
  add(legacyLinksByProduct, row.productId, row.salesLinkId);
  add(legacySkusByProductLink, `${row.productId}|${row.salesLinkId}`, row.salesLinkSkuId);
  legacyProductBySku.set(row.salesLinkSkuId, row.productId);
}

const candidateSkuIds = database.prepare("SELECT DISTINCT salesLinkSkuId FROM sales_link_sku_erp_mappings WHERE currentState='active' ORDER BY salesLinkSkuId").all().map((row) => row.salesLinkSkuId);
const relations = {};
for (let offset = 0; offset < candidateSkuIds.length; offset += 500) {
  Object.assign(relations, resolveLinkSkuErpRelations({ salesLinkSkuIds: candidateSkuIds.slice(offset, offset + 500) }, { database }).results);
}
const productMappings = database.prepare("SELECT erpSkuId,productId FROM product_erp_mappings WHERE currentState='active' AND erpSkuId IS NOT NULL").all();
const productByErpSku = new Map(productMappings.map((row) => [row.erpSkuId, row.productId]));
const v2LinksByProduct = new Map();
const v2SkusByProductLink = new Map();
for (const [salesLinkSkuId, relation] of Object.entries(relations)) {
  if (!relation.isUsable) continue;
  for (const productId of new Set(relation.mappings.map((mapping) => productByErpSku.get(mapping.erpSkuId)).filter(Boolean))) {
    add(v2LinksByProduct, productId, relation.salesLinkId);
    add(v2SkusByProductLink, `${productId}|${relation.salesLinkId}`, salesLinkSkuId);
  }
}

const linkPeriods = database.prepare(`
  SELECT salesLinkId,periodStart,periodEnd,SUM(COALESCE(salesAmount,0)) salesAmount,SUM(COALESCE(profitAmount,0)) profitAmount
  FROM connection_sku_sales_facts
  GROUP BY salesLinkId,periodStart,periodEnd
  ORDER BY salesLinkId,periodEnd DESC,periodStart DESC
`).all();
const metricsByLink = new Map();
for (const row of linkPeriods) if (!metricsByLink.has(row.salesLinkId)) metricsByLink.set(row.salesLinkId, row);
const platformByLink = new Map(database.prepare("SELECT l.id,sh.platform FROM sales_links l JOIN sales_shops sh ON sh.id=l.shopId").all().map((row) => [row.id, row.platform]));

function metrics(linkIds = new Set()) {
  let salesAmount = 0;
  let profitAmount = 0;
  const platforms = new Set();
  for (const linkId of linkIds) {
    const linkMetrics = metricsByLink.get(linkId);
    salesAmount += number(linkMetrics?.salesAmount);
    profitAmount += number(linkMetrics?.profitAmount);
    if (platformByLink.get(linkId)) platforms.add(platformByLink.get(linkId));
  }
  return { salesAmount, profitAmount, linkCount: linkIds.size, platformCount: platforms.size };
}

function classifyRemoved(productId, linkId) {
  const categories = new Set();
  for (const salesLinkSkuId of legacySkusByProductLink.get(`${productId}|${linkId}`) ?? []) {
    const relation = relations[salesLinkSkuId];
    if (!relation?.isUsable) { categories.add("C_V2关系缺失"); continue; }
    const mappedProducts = relation.mappings.map((mapping) => productByErpSku.get(mapping.erpSkuId));
    if (mappedProducts.some((mappedProductId) => !mappedProductId)) categories.add("D_产品映射缺失");
    if (mappedProducts.filter(Boolean).some((mappedProductId) => mappedProductId !== productId)) categories.add("B_旧productId错误归属");
  }
  if (!categories.size) categories.add("C_V2关系缺失");
  return categories;
}

function classifyAdded(productId, linkId) {
  const skuIds = [...(v2SkusByProductLink.get(`${productId}|${linkId}`) ?? [])];
  const legacyProducts = skuIds.map((salesLinkSkuId) => legacyProductBySku.get(salesLinkSkuId)).filter(Boolean);
  if (!legacyProducts.length) return new Set(["A_旧productId遗漏"]);
  if (legacyProducts.some((legacyProductId) => legacyProductId !== productId)) return new Set(["B_旧productId错误归属"]);
  return new Set(["A_旧productId遗漏"]);
}

const differenceProducts = [];
const categoryProducts = new Map();
for (const product of products) {
  const legacyLinks = legacyLinksByProduct.get(product.id) ?? new Set();
  const v2Links = v2LinksByProduct.get(product.id) ?? new Set();
  const addedLinks = [...v2Links].filter((linkId) => !legacyLinks.has(linkId));
  const removedLinks = [...legacyLinks].filter((linkId) => !v2Links.has(linkId));
  if (!addedLinks.length && !removedLinks.length) continue;
  const categories = new Set();
  for (const linkId of addedLinks) for (const category of classifyAdded(product.id, linkId)) categories.add(category);
  for (const linkId of removedLinks) for (const category of classifyRemoved(product.id, linkId)) categories.add(category);
  for (const category of categories) add(categoryProducts, category, product.id);
  const legacy = metrics(legacyLinks); const v2 = metrics(v2Links);
  differenceProducts.push({
    productId: product.id,
    skuCode: product.skuCode,
    name: product.name,
    categories: [...categories].sort(),
    legacy,
    v2,
    difference: {
      salesAmount: v2.salesAmount - legacy.salesAmount,
      profitAmount: v2.profitAmount - legacy.profitAmount,
      linkCount: v2.linkCount - legacy.linkCount,
      platformCount: v2.platformCount - legacy.platformCount,
    },
    addedLinks: addedLinks.sort(),
    removedLinks: removedLinks.sort(),
  });
}
differenceProducts.sort((left, right) => Math.abs(right.difference.salesAmount) - Math.abs(left.difference.salesAmount) || left.skuCode.localeCompare(right.skuCode));

function summarize(linksByProduct) {
  const uniqueLinks = new Set();
  let salesAmount = 0;
  let profitAmount = 0;
  let productLinkCount = 0;
  let productPlatformCount = 0;
  let productCount = 0;
  for (const product of products) {
    const links = linksByProduct.get(product.id) ?? new Set();
    if (!links.size) continue;
    productCount += 1;
    productLinkCount += links.size;
    for (const linkId of links) uniqueLinks.add(linkId);
    const row = metrics(links);
    salesAmount += row.salesAmount;
    profitAmount += row.profitAmount;
    productPlatformCount += row.platformCount;
  }
  return { productCount, salesAmount, profitAmount, productLinkCount, uniqueLinkCount: uniqueLinks.size, productPlatformCount };
}

const legacy = summarize(legacyLinksByProduct);
const v2 = summarize(v2LinksByProduct);
const relationStatusCounts = Object.values(relations).reduce((counts, relation) => {
  counts[relation.relationStatus] = (counts[relation.relationStatus] || 0) + 1;
  return counts;
}, {});

console.log(JSON.stringify({
  databasePath,
  scope: { productCount: products.length, activeRelationSkuCount: candidateSkuIds.length },
  legacy,
  v2,
  difference: Object.fromEntries(Object.keys(legacy).map((key) => [key, v2[key] - legacy[key]])),
  differenceProductCount: differenceProducts.length,
  categoryProductCounts: Object.fromEntries([...categoryProducts].map(([category, ids]) => [category, ids.size])),
  relationStatusCounts,
  differenceProducts,
}, null, 2));
database.close();
