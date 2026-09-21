export const productShopPlanSchema = `CREATE TABLE IF NOT EXISTS product_shop_plans (
 id TEXT PRIMARY KEY, shopId TEXT NOT NULL REFERENCES sales_shops(id),
 erpSkuId TEXT NOT NULL REFERENCES erp_skus(id),
 direction TEXT NOT NULL CHECK(direction IN ('listing','withdrawal')),
 createdBy TEXT, createdAt TEXT NOT NULL,
 UNIQUE(shopId,erpSkuId)
);`;
