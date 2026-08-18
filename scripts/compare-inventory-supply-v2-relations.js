import Database from "better-sqlite3";
import { readConnectionInventorySupplyMap, readProductInventorySupplyMap } from "../server/inventorySupplyQueryService.js";

const source = String(process.env.INVENTORY_COMPARE_DB_PATH ?? "").trim();
if (!source) throw new Error("请通过INVENTORY_COMPARE_DB_PATH指定只读数据库快照。");
const database = new Database(source, { readonly: true, fileMustExist: true });
const protectedTables = ["erp_sku_inventory_daily_summaries", "erp_skus", "sales_links", "sales_link_skus", "sales_link_sku_product_structures", "sales_link_sku_product_structure_components", "sales_link_sku_erp_mappings", "product_erp_mappings", "products"];
const counts = () => Object.fromEntries(protectedTables.map((table) => [table, Number(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count)]));
const before = counts();
const links = database.prepare("SELECT id FROM sales_links WHERE COALESCE(currentState,'active')='active' ORDER BY id").all().map((row) => row.id);
const products = database.prepare("SELECT id FROM products ORDER BY id").all().map((row) => row.id);
const latestInventory = database.prepare(`SELECT d.* FROM erp_sku_inventory_daily_summaries d
  WHERE d.businessDate=(SELECT MAX(x.businessDate) FROM erp_sku_inventory_daily_summaries x WHERE x.erpSkuId=d.erpSkuId)`).all();
const inventoryByErp = new Map(latestInventory.map((row) => [row.erpSkuId, row]));
const sum = (rows, field) => rows.reduce((total, row) => total + Number(row[field] || 0), 0);
const aggregateBy = (rows, key) => {
  const result = new Map();
  for (const row of rows) {
    const metric = result.get(row[key]) ?? { rowCount: 0, stockNum: 0, availableSendStock: 0, inventoryCostAmount: 0 };
    metric.rowCount += 1; metric.stockNum += Number(row.stockNum || 0); metric.availableSendStock += Number(row.availableSendStock || 0);
    metric.inventoryCostAmount += Number(row.inventoryCostAmount || 0); result.set(row[key], metric);
  }
  return result;
};

const legacyLinkRelations = database.prepare(`SELECT DISTINCT s.salesLinkId,s.erpSkuId FROM sales_link_skus s
  JOIN sales_links l ON l.id=s.salesLinkId
  WHERE s.erpSkuId IS NOT NULL AND COALESCE(s.currentState,'active')='active' AND COALESCE(l.currentState,'active')='active'`).all();
const legacyLinkRows = legacyLinkRelations.map((row) => ({ ...row, ...inventoryByErp.get(row.erpSkuId) })).filter((row) => row.businessDate);
const legacyLinks = aggregateBy(legacyLinkRows, "salesLinkId");
const v2Connection = readConnectionInventorySupplyMap(links, { includeCost: true, database });
const v2LinkRows = [...v2Connection].flatMap(([salesLinkId, value]) => value.rows.filter((row) => row.source === "wangdian").map((row) => ({ salesLinkId, ...row })));
const v2Links = aggregateBy(v2LinkRows, "salesLinkId");
const availability = [...v2Connection].flatMap(([salesLinkId, value]) => value.linkSkuAvailability.map((row) => ({ salesLinkId, ...row })));

const legacyProductRelations = database.prepare(`SELECT DISTINCT m.productId,s.id erpSkuId FROM product_erp_mappings m
  JOIN erp_skus s ON lower(s.merchantSkuCode)=lower(m.merchantSkuCode)
  WHERE COALESCE(m.currentState,'active')='active' AND COALESCE(s.currentState,'active')='active'`).all();
const legacyProductRows = legacyProductRelations.map((row) => ({ ...row, ...inventoryByErp.get(row.erpSkuId) })).filter((row) => row.businessDate);
const legacyProducts = aggregateBy(legacyProductRows, "productId");
const v2ProductRead = readProductInventorySupplyMap(products, { includeCost: true, database });
const v2ProductRows = [...v2ProductRead].flatMap(([productId, value]) => value.rows.map((row) => ({ productId, ...row })));
const v2Products = aggregateBy(v2ProductRows, "productId");

function differences(oldMap, newMap, idName) {
  return [...new Set([...oldMap.keys(), ...newMap.keys()])].map((id) => {
    const oldValue = oldMap.get(id) ?? {}; const newValue = newMap.get(id) ?? {};
    return { [idName]: id, legacyStockNum: Number(oldValue.stockNum || 0), v2StockNum: Number(newValue.stockNum || 0),
      stockDifference: Number(newValue.stockNum || 0) - Number(oldValue.stockNum || 0),
      legacyAvailableSendStock: Number(oldValue.availableSendStock || 0), v2AvailableSendStock: Number(newValue.availableSendStock || 0),
      availableDifference: Number(newValue.availableSendStock || 0) - Number(oldValue.availableSendStock || 0),
      legacyRowCount: Number(oldValue.rowCount || 0), v2RowCount: Number(newValue.rowCount || 0) };
  }).filter((row) => row.stockDifference || row.availableDifference || row.legacyRowCount !== row.v2RowCount)
    .sort((left, right) => Math.max(Math.abs(right.stockDifference), Math.abs(right.availableDifference)) - Math.max(Math.abs(left.stockDifference), Math.abs(left.availableDifference)));
}
const linkDifferences = differences(legacyLinks, v2Links, "salesLinkId");
const productDifferences = differences(legacyProducts, v2Products, "productId");
const classifyDifferences = (rows) => ({
  total: rows.length,
  addedByV2: rows.filter((row) => row.legacyRowCount === 0 && row.v2RowCount > 0).length,
  removedByV2: rows.filter((row) => row.legacyRowCount > 0 && row.v2RowCount === 0).length,
  changedRelation: rows.filter((row) => row.legacyRowCount > 0 && row.v2RowCount > 0).length,
});
const shapeSummary = Object.fromEntries([...new Set(availability.map((row) => row.relationshipShape))].sort().map((shape) => [shape, availability.filter((row) => row.relationshipShape === shape).length]));
const result = {
  legacy: { inventoryLinkCount: legacyLinks.size, componentRowCount: legacyLinkRows.length, stockNum: sum(legacyLinkRows, "stockNum"), availableSendStock: sum(legacyLinkRows, "availableSendStock"), inventoryProductCount: legacyProducts.size },
  v2: { inventoryLinkCount: v2Links.size, componentRowCount: v2LinkRows.length, stockNum: sum(v2LinkRows, "stockNum"), availableSendStock: sum(v2LinkRows, "availableSendStock"), inventoryProductCount: v2Products.size,
    linkSkuAvailabilityCount: availability.length, shapeSummary },
  differences: { links: classifyDifferences(linkDifferences), products: classifyDifferences(productDifferences), linkTop: linkDifferences.slice(0, 30), productTop: productDifferences.slice(0, 30) },
  complexRelationValidation: {
    singleMultiQuantityCount: availability.filter((row) => row.relationshipShape === "single_multi_quantity").length,
    multiComponentCount: availability.filter((row) => row.relationshipShape === "multi_component").length,
    singleMultiQuantityExamples: availability.filter((row) => row.relationshipShape === "single_multi_quantity").slice(0, 10),
    multiComponentExamples: availability.filter((row) => row.relationshipShape === "multi_component").slice(0, 10),
  },
  protectedTables: { before, after: counts(), unchanged: JSON.stringify(before) === JSON.stringify(counts()) },
  integrityCheck: database.pragma("integrity_check", { simple: true }), foreignKeyCheck: database.pragma("foreign_key_check").length,
};
console.log(JSON.stringify(result, null, 2));
database.close();
