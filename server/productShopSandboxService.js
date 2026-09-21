import { getDatabase } from "./db.js";
import { readErpSkuInventorySupplyMap } from "./inventorySupplyQueryService.js";
import { queryErpSkuContributions } from "./productContributionReadModel.js";
import { latestCompleteSalesDate, resolveProductSalesDistributionRange } from "./productSalesDistributionService.js";
import { wangdianOperatingSkuPredicate } from "./wangdianProductStatus.js";

const text = (value) => String(value ?? "").trim();

function readShops(database, range) {
  return database.prepare(`
    SELECT s.id,s.platform,COALESCE(NULLIF(s.displayName,''),s.shopName) name,
      COUNT(DISTINCT l.id) linkCount,COUNT(DISTINCT f.id) factCount
    FROM sales_shops s
    LEFT JOIN sales_links l ON l.shopId=s.id
    LEFT JOIN connection_sku_sales_daily_facts f
      ON f.salesLinkId=l.id AND f.saleDate BETWEEN ? AND ?
    WHERE s.status='active'
    GROUP BY s.id,s.platform,s.displayName,s.shopName
    HAVING COUNT(DISTINCT l.id)>0
    ORDER BY COUNT(DISTINCT f.id) DESC,s.platform,COALESCE(NULLIF(s.displayName,''),s.shopName),s.id
  `).all(range.startDate, range.endDate).map((shop) => ({
    id: shop.id,
    platform: shop.platform,
    name: shop.name,
    linkCount: Number(shop.linkCount || 0),
    factCount: Number(shop.factCount || 0),
  }));
}

export function getProductShopSandbox(input = {}, options = {}) {
  const database = options.database || getDatabase();
  const range = resolveProductSalesDistributionRange(input, latestCompleteSalesDate(database));
  const shops = readShops(database, range);
  const requestedShopId = text(input.shopId);
  const selectedShop = requestedShopId ? shops.find((shop) => shop.id === requestedShopId) : shops[0];
  if (requestedShopId && !selectedShop) throw new Error("产品沙盘店铺不存在或已停用。");
  if (!selectedShop) {
    return {
      range,
      shops: [],
      selectedShop: null,
      items: [],
      summary: { productCount: 0, productsWithSales: 0, productsWithoutSales: 0, slowMovingProducts: 0, outOfStockProducts: 0, totalSalesQuantity: 0 },
      definitions: { salesQuantity: "directSalesQuantity + bundleContributionQuantity", readOnly: true },
    };
  }

  const salesLinkIds = database.prepare("SELECT id FROM sales_links WHERE shopId=? ORDER BY id").all(selectedShop.id).map((row) => row.id);
  const linkedErpSkuIds = new Set(database.prepare(`
    SELECT DISTINCT component.erpSkuId
    FROM sales_links link
    JOIN sales_link_skus linkSku ON linkSku.salesLinkId=link.id AND COALESCE(linkSku.currentState,'active')='active'
    JOIN sales_link_sku_sales_object_relations relation ON relation.linkSkuId=linkSku.id AND relation.status='active'
    JOIN sales_object_structures structure ON structure.salesObjectId=relation.salesObjectId AND structure.status='active'
    JOIN sales_object_structure_components component ON component.structureId=structure.id AND component.status='active'
    WHERE link.shopId=? AND COALESCE(link.currentState,'active')='active'
  `).all(selectedShop.id).map((row) => row.erpSkuId));
  const withdrawalSkuIds = new Set(database.prepare(
    "SELECT erpSkuId FROM product_shop_plans WHERE shopId=? AND direction='withdrawal'",
  ).all(selectedShop.id).map((row) => row.erpSkuId));
  const visible = options.visibleErpSkuIds === undefined
    ? null
    : new Set((options.visibleErpSkuIds || []).map(text).filter(Boolean));
  const products = database.prepare(`
    SELECT sku.id erpSkuId,mapping.productId,
      COALESCE(NULLIF(profile.displayNameOverride,''),NULLIF(product.name,''),NULLIF(goods.goodsName,''),sku.merchantSkuCode) name,
      sku.merchantSkuCode skuCode,COALESCE(NULLIF(sku.mainImage,''),NULLIF(product.mainImage,'')) mainImage,
      COALESCE(NULLIF(profile.businessStatus,''),NULLIF(product.status,''),sku.currentState) status
    FROM erp_skus sku
    JOIN erp_goods goods ON goods.id=sku.erpGoodsId
    LEFT JOIN product_business_profiles profile ON profile.erpSkuId=sku.id
    LEFT JOIN product_erp_mappings mapping ON mapping.id=(
      SELECT candidate.id FROM product_erp_mappings candidate
      WHERE candidate.erpSkuId=sku.id AND candidate.currentState='active'
      ORDER BY candidate.updatedAt DESC,candidate.id DESC LIMIT 1
    )
    LEFT JOIN products product ON product.id=mapping.productId
    WHERE ${wangdianOperatingSkuPredicate(database, "sku")}
    ORDER BY sku.id
  `).all().filter((product) => linkedErpSkuIds.has(product.erpSkuId) && !withdrawalSkuIds.has(product.erpSkuId) && (!visible || visible.has(product.erpSkuId)));
  const contribution = products.length ? queryErpSkuContributions({
    periodStart: range.startDate,
    periodEnd: range.endDate,
    erpSkuIds: products.map((product) => product.erpSkuId),
    salesLinkIds,
  }, { database, bypassCache: options.bypassCache === true }) : { items: [] };
  const contributionByProduct = new Map(contribution.items.map((item) => [item.erpSkuId, item]));
  const inventoryByProduct = readErpSkuInventorySupplyMap(products.map((product) => product.erpSkuId), { database });
  const items = products.map((product) => {
    const metric = contributionByProduct.get(product.erpSkuId);
    const inventory = inventoryByProduct.get(product.erpSkuId)?.summary;
    const inventoryQuantity = inventory?.stockNum ?? null;
    return {
      erpSkuId: product.erpSkuId,
      productId: product.productId || null,
      productName: product.name,
      skuCode: product.skuCode,
      mainImage: product.mainImage || "",
      status: product.status,
      salesQuantity: metric?.totalPhysicalContribution ?? 0,
      directSalesQuantity: metric?.directSalesQuantity ?? null,
      bundleContributionQuantity: metric?.bundleContributionQuantity ?? null,
      hasSales: Number(metric?.totalPhysicalContribution || 0) !== 0,
      inventoryQuantity,
      hasInventoryData: inventoryQuantity !== null,
    };
  }).sort((left, right) => Number(right.salesQuantity) - Number(left.salesQuantity)
      || String(left.skuCode || left.productName).localeCompare(String(right.skuCode || right.productName), "zh-CN", { numeric: true }));
  const limit = Math.min(200, Math.max(20, Number(input.limit) || 100));
  const offset = Math.max(0, Number(input.offset) || 0);
  const pageItems = items.slice(offset, offset + limit);

  return {
    range,
    shops,
    selectedShop,
    items: pageItems,
    pagination: { total: items.length, limit, offset, hasMore: offset + pageItems.length < items.length },
    summary: {
      productCount: items.length,
      productsWithSales: items.filter((item) => item.hasSales).length,
      productsWithoutSales: items.filter((item) => !item.hasSales).length,
      slowMovingProducts: items.filter((item) => !item.hasSales && item.hasInventoryData && Number(item.inventoryQuantity) > 0).length,
      outOfStockProducts: items.filter((item) => item.hasInventoryData && Number(item.inventoryQuantity) <= 0).length,
      totalSalesQuantity: items.reduce((sum, item) => sum + Number(item.salesQuantity || 0), 0),
    },
    definitions: {
      salesQuantity: "Direct Sales Quantity + Bundle Contribution Quantity",
      identity: "ERP SKU",
      productScope: "店铺全部在用 Sales Link 通过 Sales Object 关联的 ERP SKU",
      slowMovingProduct: "所选周期销量为0且当前库存大于0",
      outOfStockProduct: "存在库存事实且当前库存小于等于0",
      shopScope: "Sales Shop → Sales Link → Daily Sales Fact → Sales Object → ERP SKU",
      readOnly: true,
    },
  };
}

export default getProductShopSandbox;
