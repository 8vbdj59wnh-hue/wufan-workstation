import { getDatabase } from "./db.js";
import { readConnectionProductsBySalesLinkIds } from "./connectionService.js";
import { readProductInventorySupplyMap } from "./inventorySupplyQueryService.js";
import { queryProductContributions } from "./productContributionReadModel.js";
import { latestCompleteSalesDate, resolveProductSalesDistributionRange } from "./productSalesDistributionService.js";

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
  const linkedProductsByLink = readConnectionProductsBySalesLinkIds(database, salesLinkIds);
  const linkedProductIds = new Set([...linkedProductsByLink.values()].flat().map((product) => product.id));
  const visible = options.visibleProductIds === undefined
    ? null
    : new Set((options.visibleProductIds || []).map(text).filter(Boolean));
  const products = database.prepare(`
    SELECT id,name,skuCode,mainImage,status
    FROM products
    ORDER BY id
  `).all().filter((product) => linkedProductIds.has(product.id) && (!visible || visible.has(product.id)));
  const contribution = products.length ? queryProductContributions({
    periodStart: range.startDate,
    periodEnd: range.endDate,
    productIds: products.map((product) => product.id),
    salesLinkIds,
  }, { database }) : { items: [] };
  const contributionByProduct = new Map(contribution.items.map((item) => [item.productId, item]));
  const inventoryByProduct = readProductInventorySupplyMap(products.map((product) => product.id), { database });
  const items = products.map((product) => {
    const metric = contributionByProduct.get(product.id);
    const inventory = inventoryByProduct.get(product.id)?.summary;
    const inventoryQuantity = inventory?.stockNum ?? null;
    return {
      productId: product.id,
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

  return {
    range,
    shops,
    selectedShop,
    items,
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
      productScope: "店铺全部在用Sales Link关联的当前有效产品",
      slowMovingProduct: "所选周期销量为0且当前库存大于0",
      outOfStockProduct: "存在库存事实且当前库存小于等于0",
      shopScope: "Sales Shop → Sales Link → Daily Sales Fact → Sales Object → Product Mapping",
      readOnly: true,
    },
  };
}

export default getProductShopSandbox;
