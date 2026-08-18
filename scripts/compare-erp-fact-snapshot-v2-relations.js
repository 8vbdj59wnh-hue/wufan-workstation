import Database from "better-sqlite3";
import { buildErpSnapshotRows, collectErpSnapshotFacts } from "../server/erpFactSnapshots.js";

const source = String(process.env.ERP_SNAPSHOT_COMPARE_DB_PATH ?? "").trim();
if (!source) throw new Error("请通过ERP_SNAPSHOT_COMPARE_DB_PATH指定只读数据库快照。");
const database = new Database(source, { readonly: true, fileMustExist: true });
const protectedTables = ["erp_fact_snapshots", "product_daily_snapshots", "product_erp_daily_snapshots", "sales_link_daily_snapshots", "sales_link_sku_daily_snapshots", "product_shop_daily_snapshots", "erp_skus", "erp_goods", "products", "sales_link_skus", "sales_link_sku_product_structures", "sales_link_sku_erp_mappings"];
const counts = () => Object.fromEntries(protectedTables.map((table) => [table, Number(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count)]));
const before = counts();
const facts = collectErpSnapshotFacts(database);
const snapshot = { id: "read-only-comparison", businessDate: "comparison", createdAt: "comparison" };
const run = { inventoryBatchId: null, platformGoodsBatchId: null };
const v2Rows = buildErpSnapshotRows(facts, snapshot, run);
const shopsById = new Map(facts.shops.map((shop) => [shop.id, shop]));
const linksById = new Map(facts.links.map((link) => [link.id, link]));
const oldValidStatuses = new Set(["matched_auto", "matched_manual"]);

function coverageFromPairs(pairs) {
  const result = new Map();
  for (const { productId, sku } of pairs) {
    if (!productId) continue;
    const link = linksById.get(sku.salesLinkId); const shop = link ? shopsById.get(link.shopId) : null;
    if (!link || !shop) continue;
    const metric = result.get(productId) ?? { links: new Set(), shops: new Set(), platforms: new Set(), skus: new Set() };
    metric.links.add(link.id); metric.shops.add(shop.id); metric.platforms.add(shop.platform); metric.skus.add(sku.id); result.set(productId, metric);
  }
  return result;
}
const legacyPairs = facts.skus.filter((sku) => sku.productId && oldValidStatuses.has(sku.matchStatus)).map((sku) => ({ productId: sku.productId, sku }));
const v2Pairs = facts.skus.flatMap((sku) => (facts.relationsBySku.get(sku.id)?.productIds ?? []).map((productId) => ({ productId, sku })));
const legacyCoverage = coverageFromPairs(legacyPairs); const v2Coverage = coverageFromPairs(v2Pairs);
const productIds = [...new Set([...legacyCoverage.keys(), ...v2Coverage.keys()])];
const coverageDifferences = productIds.map((productId) => {
  const oldValue = legacyCoverage.get(productId); const newValue = v2Coverage.get(productId);
  return { productId, legacyPlatformCount: oldValue?.platforms.size ?? 0, v2PlatformCount: newValue?.platforms.size ?? 0,
    legacyShopCount: oldValue?.shops.size ?? 0, v2ShopCount: newValue?.shops.size ?? 0,
    legacyLinkCount: oldValue?.links.size ?? 0, v2LinkCount: newValue?.links.size ?? 0,
    legacyPlatformSkuCount: oldValue?.skus.size ?? 0, v2PlatformSkuCount: newValue?.skus.size ?? 0 };
}).filter((row) => row.legacyPlatformCount !== row.v2PlatformCount || row.legacyShopCount !== row.v2ShopCount || row.legacyLinkCount !== row.v2LinkCount || row.legacyPlatformSkuCount !== row.v2PlatformSkuCount)
  .sort((left, right) => Math.abs(right.v2LinkCount - right.legacyLinkCount) - Math.abs(left.v2LinkCount - left.legacyLinkCount));
const relations = [...facts.relationsBySku.values()];
const relationshipShapes = Object.fromEntries([...new Set(relations.map((row) => row.relationshipShape).filter(Boolean))].sort().map((shape) => [shape, relations.filter((row) => row.relationshipShape === shape).length]));
const result = {
  existingSnapshots: { snapshotCount: before.erp_fact_snapshots, productRows: before.product_daily_snapshots, erpRows: before.product_erp_daily_snapshots,
    linkRows: before.sales_link_daily_snapshots, linkSkuRows: before.sales_link_sku_daily_snapshots, productShopRows: before.product_shop_daily_snapshots },
  simulatedRowCounts: { products: v2Rows.productRows.length, erp: v2Rows.erpRows.length, links: v2Rows.linkRows.length, linkSkus: v2Rows.skuRows.length,
    legacyProducts: facts.products.length, legacyErp: facts.mappings.length, legacyLinks: facts.links.length, legacyLinkSkus: facts.skus.length,
    legacyProductShopRelations: [...new Set(legacyPairs.map(({ productId, sku }) => `${productId}|${linksById.get(sku.salesLinkId)?.shopId || ""}`).filter((key) => !key.endsWith("|")))].length,
    v2ProductShopRelations: v2Rows.relationRows.length },
  attribution: { legacyAssignedLinkSkus: new Set(legacyPairs.map((row) => row.sku.id)).size, v2AssignedLinkSkus: new Set(v2Pairs.map((row) => row.sku.id)).size,
    v2ProductRelationCount: v2Pairs.length, singleProductLinkSkus: relations.filter((row) => row.productIds.length === 1).length,
    multiProductLinkSkus: relations.filter((row) => row.productIds.length > 1).length, unresolvedProductLinkSkus: relations.filter((row) => row.productIds.length === 0).length,
    relationshipShapes },
  coverageDifferences: { productCount: coverageDifferences.length,
    addedProducts: coverageDifferences.filter((row) => row.legacyLinkCount === 0 && row.v2LinkCount > 0).length,
    removedProducts: coverageDifferences.filter((row) => row.legacyLinkCount > 0 && row.v2LinkCount === 0).length,
    top: coverageDifferences.slice(0, 30) },
  protectedTables: { before, after: counts(), unchanged: JSON.stringify(before) === JSON.stringify(counts()) },
  integrityCheck: database.pragma("integrity_check", { simple: true }), foreignKeyCheck: database.pragma("foreign_key_check").length,
};
console.log(JSON.stringify(result, null, 2));
database.close();
