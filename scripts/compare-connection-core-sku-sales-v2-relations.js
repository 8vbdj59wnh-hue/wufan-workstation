import path from "node:path";
import Database from "better-sqlite3";
import { resolveLinkSkuErpRelations } from "../server/capabilities/resolveLinkSkuErpRelation.js";

const source = String(process.env.CORE_SKU_COMPARE_DB_PATH ?? "").trim();
if (!source) throw new Error("请通过 CORE_SKU_COMPARE_DB_PATH 指定只读数据库快照。");
const databasePath = path.resolve(source);
const database = new Database(databasePath, { readonly: true, fileMustExist: true });
const salesLinkIds = database.prepare("SELECT DISTINCT salesLinkId FROM connection_profiles ORDER BY salesLinkId").all().map((row) => row.salesLinkId);
const marks = salesLinkIds.map(() => "?").join(",");
const periodRows = database.prepare(`
  SELECT salesLinkId,periodStart,periodEnd
  FROM connection_sku_sales_facts
  WHERE salesLinkId IN (${marks})
  GROUP BY salesLinkId,periodStart,periodEnd
  ORDER BY salesLinkId,periodEnd DESC,periodStart DESC
`).all(...salesLinkIds);
const latestByLink = new Map();
for (const row of periodRows) if (!latestByLink.has(row.salesLinkId)) latestByLink.set(row.salesLinkId, `${row.periodStart}|${row.periodEnd}`);
const factRows = database.prepare(`
  SELECT f.salesLinkId,f.salesLinkSkuId,f.skuCode,f.periodStart,f.periodEnd,f.shippedQuantity,f.salesAmount,f.profitAmount,
    s.productId legacyProductId,s.erpSkuId legacyErpSkuId,s.specificationName
  FROM connection_sku_sales_facts f
  JOIN sales_link_skus s ON s.id=f.salesLinkSkuId
  WHERE f.salesLinkId IN (${marks})
`).all(...salesLinkIds).filter((row) => `${row.periodStart}|${row.periodEnd}` === latestByLink.get(row.salesLinkId));
const grouped = new Map();
for (const row of factRows) {
  const key = `${row.salesLinkId}|${row.salesLinkSkuId}|${row.skuCode}`;
  const current = grouped.get(key) ?? { ...row, shippedQuantity: 0, salesAmount: 0, profitAmount: 0 };
  current.shippedQuantity += Number(row.shippedQuantity || 0);
  current.salesAmount += Number(row.salesAmount || 0);
  current.profitAmount += Number(row.profitAmount || 0);
  grouped.set(key, current);
}
const skuRows = [...grouped.values()];
const salesLinkSkuIds = [...new Set(skuRows.map((row) => row.salesLinkSkuId))];
const relations = {};
for (let offset = 0; offset < salesLinkSkuIds.length; offset += 500) {
  Object.assign(relations, resolveLinkSkuErpRelations({ salesLinkSkuIds: salesLinkSkuIds.slice(offset, offset + 500) }, { database }).results);
}
const productByErpSku = new Map(database.prepare("SELECT erpSkuId,productId FROM product_erp_mappings WHERE currentState='active' AND erpSkuId IS NOT NULL").all().map((row) => [row.erpSkuId, row.productId]));

const legacyProductIds = new Set(skuRows.map((row) => row.legacyProductId).filter(Boolean));
const v2ProductIds = new Set();
const categories = new Map();
const relationshipShapeCounts = {};
let legacyErpRelationDisplayCount = 0;
let v2ErpRelationDisplayCount = 0;
function record(category, row, relation) {
  const current = categories.get(category) ?? { skuCount: 0, salesAmount: 0, shippedQuantity: 0, examples: [] };
  current.skuCount += 1;
  current.salesAmount += Number(row.salesAmount || 0);
  current.shippedQuantity += Number(row.shippedQuantity || 0);
  if (current.examples.length < 10) current.examples.push({
    salesLinkId: row.salesLinkId,
    salesLinkSkuId: row.salesLinkSkuId,
    skuCode: row.skuCode,
    legacyProductId: row.legacyProductId,
    legacyErpSkuId: row.legacyErpSkuId,
    relationStatus: relation?.relationStatus ?? "missing",
    erpSkuIds: (relation?.mappings ?? []).map((mapping) => mapping.erpSkuId),
  });
  categories.set(category, current);
}
for (const row of skuRows) {
  const relation = relations[row.salesLinkSkuId];
  if (row.legacyErpSkuId) legacyErpRelationDisplayCount += 1;
  const mappings = relation?.mappings ?? [];
  v2ErpRelationDisplayCount += mappings.length;
  relationshipShapeCounts[relation?.relationshipShape ?? "missing"] = (relationshipShapeCounts[relation?.relationshipShape ?? "missing"] || 0) + 1;
  const productIds = [...new Set(mappings.map((mapping) => productByErpSku.get(mapping.erpSkuId)).filter(Boolean))];
  if (relation?.isUsable) for (const productId of productIds) v2ProductIds.add(productId);
  if (!row.legacyProductId && productIds.length) record("A_旧productId遗漏", row, relation);
  if (!row.legacyErpSkuId && mappings.length) record("B_旧erpSkuId遗漏", row, relation);
  if (!relation?.isUsable || !mappings.length) record("C_V2关系缺失", row, relation);
  if (mappings.some((mapping) => !productByErpSku.get(mapping.erpSkuId))) record("D_ERP产品映射缺失", row, relation);
}

const totals = {
  skuCount: skuRows.length,
  salesAmount: skuRows.reduce((sum, row) => sum + Number(row.salesAmount || 0), 0),
  shippedQuantity: skuRows.reduce((sum, row) => sum + Number(row.shippedQuantity || 0), 0),
};
const legacy = { ...totals, productCount: legacyProductIds.size, erpRelationDisplayCount: legacyErpRelationDisplayCount };
const v2 = { ...totals, productCount: v2ProductIds.size, erpRelationDisplayCount: v2ErpRelationDisplayCount };
console.log(JSON.stringify({
  databasePath,
  scope: { connectionCount: salesLinkIds.length, latestPeriodLinkCount: latestByLink.size, latestSkuFactGroupCount: skuRows.length },
  legacy,
  v2,
  difference: Object.fromEntries(Object.keys(legacy).map((key) => [key, v2[key] - legacy[key]])),
  salesAndQuantityExactlyEqual: legacy.salesAmount === v2.salesAmount && legacy.shippedQuantity === v2.shippedQuantity,
  relationshipShapeCounts,
  categories: Object.fromEntries([...categories].map(([category, row]) => [category, row])),
}, null, 2));
database.close();
