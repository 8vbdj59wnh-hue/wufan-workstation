import { createProductFromErpSku } from "./erpSkuService.js";
import { getDatabase } from "./db.js";

const text = (value) => String(value ?? "").trim();
const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function whereClause({ search = "", profileStatus = "all", erpStatus = "" } = {}) {
  const conditions = ["s.currentState='active'"];
  const params = {};
  if (text(search)) {
    params.search = `%${text(search)}%`;
    conditions.push("(s.merchantSkuCode LIKE @search OR COALESCE(s.specificationName,'') LIKE @search OR COALESCE(g.goodsName,'') LIKE @search OR COALESCE(g.goodsCode,'') LIKE @search OR COALESCE(p.name,'') LIKE @search)");
  }
  if (profileStatus === "profiled") conditions.push("p.id IS NOT NULL");
  if (profileStatus === "unprofiled") conditions.push("p.id IS NULL");
  if (text(erpStatus)) { params.erpStatus = text(erpStatus); conditions.push("COALESCE(s.erpStatus,'')=@erpStatus"); }
  return { sql: conditions.join(" AND "), params };
}

function baseCtes() {
  return `
    WITH latest_inventory AS (
      SELECT * FROM (
        SELECT i.*,ROW_NUMBER() OVER (PARTITION BY i.erpSkuId ORDER BY i.businessDate DESC,i.updatedAt DESC) position
        FROM erp_sku_inventory_daily_summaries i
      ) WHERE position=1
    ), link_rollup AS (
      SELECT m.erpSkuId,COUNT(DISTINCT x.salesLinkId) linkCount,COUNT(DISTINCT m.salesLinkSkuId) platformSkuCount
      FROM sales_link_sku_erp_mappings m
      JOIN sales_link_skus x ON x.id=m.salesLinkSkuId AND x.currentState='active'
      WHERE m.currentState='active'
      GROUP BY m.erpSkuId
    ), sales_rollup AS (
      SELECT erpSkuId,SUM(COALESCE(shippedQuantity,0)) quantity,SUM(COALESCE(salesAmount,0)) salesAmount,
        SUM(COALESCE(costAmount,0)) costAmount,SUM(COALESCE(profitAmount,0)) profitAmount
      FROM connection_sku_sales_facts WHERE erpSkuId IS NOT NULL GROUP BY erpSkuId
    )`;
}

export function listProductCenterV2Skus(options = {}) {
  const database = getDatabase();
  const limit = Math.min(200, Math.max(20, number(options.limit, 50)));
  const offset = Math.max(0, number(options.offset, 0));
  const where = whereClause(options);
  const from = `FROM erp_skus s JOIN erp_goods g ON g.id=s.erpGoodsId
    LEFT JOIN product_erp_mappings m ON m.erpSkuId=s.id AND m.currentState='active'
    LEFT JOIN products p ON p.id=m.productId`;
  const total = database.prepare(`SELECT COUNT(*) total ${from} WHERE ${where.sql}`).get(where.params).total;
  const summary = database.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN p.id IS NOT NULL THEN 1 ELSE 0 END) profiled,
      SUM(CASE WHEN p.id IS NULL THEN 1 ELSE 0 END) unprofiled
    ${from} WHERE s.currentState='active'`).get();
  const rows = database.prepare(`${baseCtes()}
    SELECT s.id erpSkuId,s.merchantSkuCode,s.erpGoodsId,s.specificationName,s.barcode,s.unit,s.erpStatus,s.mainImage skuImage,
      s.sourceUpdatedAt,s.updatedAt skuUpdatedAt,g.goodsCode,g.goodsName,g.brand erpBrand,g.category erpCategory,
      p.id productId,p.name productName,p.mainImage productImage,p.brand,p.category,p.ownerId,p.status lifecycleStatus,
      CASE WHEN p.id IS NULL THEN 'unprofiled' ELSE 'profiled' END profileStatus,
      i.businessDate inventoryDate,i.stockNum,i.availableSendStock,i.costPrice,i.inventoryCostAmount,i.sales7d,i.salesMonth,i.sales90d,
      COALESCE(l.linkCount,0) linkCount,COALESCE(l.platformSkuCount,0) platformSkuCount,
      COALESCE(f.quantity,0) quantity,COALESCE(f.salesAmount,0) salesAmount,COALESCE(f.costAmount,0) salesCostAmount,COALESCE(f.profitAmount,0) profitAmount
    ${from}
    LEFT JOIN latest_inventory i ON i.erpSkuId=s.id
    LEFT JOIN link_rollup l ON l.erpSkuId=s.id
    LEFT JOIN sales_rollup f ON f.erpSkuId=s.id
    WHERE ${where.sql}
    ORDER BY CASE WHEN p.id IS NULL THEN 1 ELSE 0 END,LOWER(s.merchantSkuCode),s.id LIMIT @limit OFFSET @offset`)
    .all({ ...where.params, limit, offset });
  return { rows, pagination: { total: Number(total), limit, offset }, summary: { total: Number(summary.total || 0), profiled: Number(summary.profiled || 0), unprofiled: Number(summary.unprofiled || 0) } };
}

export function getProductCenterV2SkuDetail(erpSkuId) {
  const database = getDatabase();
  const sku = database.prepare(`SELECT s.*,g.goodsCode,g.goodsName,g.shortName,g.brand erpBrand,g.category erpCategory,g.productType,
      m.id mappingId,m.productId,m.currentState mappingState,p.name productName,p.mainImage productImage,p.brand,p.category,p.ownerId,p.status lifecycleStatus,p.remark
    FROM erp_skus s JOIN erp_goods g ON g.id=s.erpGoodsId
    LEFT JOIN product_erp_mappings m ON m.erpSkuId=s.id AND m.currentState='active'
    LEFT JOIN products p ON p.id=m.productId WHERE s.id=?`).get(text(erpSkuId));
  if (!sku) throw new Error("ERP SKU不存在。");
  const inventory = database.prepare(`SELECT * FROM erp_sku_inventory_daily_summaries WHERE erpSkuId=? ORDER BY businessDate DESC,updatedAt DESC LIMIT 1`).get(sku.id) ?? null;
  const links = database.prepare(`SELECT m.id mappingId,m.mappingType,m.quantity,x.id salesLinkSkuId,x.platformSkuId,x.platformSkuCode,x.specificationName platformSpecification,
      l.id salesLinkId,l.platformGoodsId,l.title,s.platform,s.displayName shopName,c.id connectionId
    FROM sales_link_sku_erp_mappings m JOIN sales_link_skus x ON x.id=m.salesLinkSkuId
    JOIN sales_links l ON l.id=x.salesLinkId JOIN sales_shops s ON s.id=l.shopId
    LEFT JOIN connection_profiles c ON c.salesLinkId=l.id
    WHERE m.erpSkuId=? AND m.currentState='active' ORDER BY s.platform,s.displayName,l.title`).all(sku.id);
  const sales = database.prepare(`SELECT COUNT(*) factCount,MIN(periodStart) firstPeriod,MAX(periodEnd) lastPeriod,
      SUM(COALESCE(shippedQuantity,0)) quantity,SUM(COALESCE(salesAmount,0)) salesAmount,
      SUM(COALESCE(costAmount,0)) costAmount,SUM(COALESCE(profitAmount,0)) profitAmount
    FROM connection_sku_sales_facts WHERE erpSkuId=?`).get(sku.id);
  const salesTrend = database.prepare(`SELECT periodStart,periodEnd,SUM(COALESCE(shippedQuantity,0)) quantity,
      SUM(COALESCE(salesAmount,0)) salesAmount,SUM(COALESCE(costAmount,0)) costAmount,SUM(COALESCE(profitAmount,0)) profitAmount
    FROM connection_sku_sales_facts WHERE erpSkuId=? GROUP BY periodStart,periodEnd ORDER BY periodEnd DESC LIMIT 90`).all(sku.id);
  return { sku, inventory, links, sales, salesTrend };
}

export function createProductProfileForErpSku(erpSkuId) {
  return createProductFromErpSku(text(erpSkuId));
}
