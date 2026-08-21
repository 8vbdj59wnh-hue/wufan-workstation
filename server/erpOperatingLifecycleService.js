import { getDatabase } from "./db.js";

export const ERP_OPERATING_LIFECYCLE = Object.freeze({
  active: "Active",
  active_dependency: "Active Dependency",
  sales_active: "Sales Active",
  archived: "Archived",
  external_unused: "External / Unused",
});

export const OPERATING_ERP_LIFECYCLE_STATUSES = Object.freeze(["active", "active_dependency", "sales_active"]);
export const NON_OPERATING_ERP_LIFECYCLE_STATUSES = Object.freeze(["archived", "external_unused"]);

const text = (value) => String(value ?? "").trim();
const positiveInteger = (value, fallback, maximum = 200) => Math.min(maximum, Math.max(1, Number.parseInt(value, 10) || fallback));
const enabled = (value) => value === true || text(value).toLowerCase() === "true" || text(value) === "1";

function lifecycleReady(database) {
  return Number(database.prepare("SELECT COUNT(*) total FROM operating_erp_set_members WHERE erpSkuId IS NOT NULL").get()?.total || 0) > 0;
}

function latestInventorySql() {
  return `SELECT * FROM (
    SELECT i.*,ROW_NUMBER() OVER (PARTITION BY i.erpSkuId ORDER BY i.businessDate DESC,i.updatedAt DESC,i.id DESC) position
    FROM erp_sku_inventory_daily_summaries i
  ) WHERE position=1`;
}

export function readErpOperatingLifecycleSummary(options = {}) {
  const database = options.database || getDatabase();
  if (!lifecycleReady(database)) return { ready: false, calculatedAt: null, total: 0, operating: 0, nonOperating: 0, items: [] };
  const rows = database.prepare(`WITH latest_inventory AS (${latestInventorySql()})
    SELECT m.lifecycleStatus,COUNT(DISTINCT m.erpSkuId) erpSkuCount,COUNT(DISTINCT pm.productId) productCount,
      COALESCE(SUM(CASE WHEN COALESCE(i.stockNum,0)>0 THEN i.stockNum ELSE 0 END),0) inventoryQuantity,
      COALESCE(SUM(CASE WHEN COALESCE(i.stockNum,0)>0 THEN COALESCE(i.inventoryCostAmount,0) ELSE 0 END),0) inventoryAmount,
      COUNT(DISTINCT CASE WHEN COALESCE(i.stockNum,0)>0 OR COALESCE(i.availableSendStock,0)>0 THEN m.erpSkuId END) inventorySkuCount
    FROM operating_erp_set_members m
    LEFT JOIN product_erp_mappings pm ON pm.erpSkuId=m.erpSkuId AND pm.currentState='active'
    LEFT JOIN latest_inventory i ON i.erpSkuId=m.erpSkuId
    WHERE m.erpSkuId IS NOT NULL GROUP BY m.lifecycleStatus`).all();
  const items = Object.keys(ERP_OPERATING_LIFECYCLE).map((status) => {
    const row = rows.find((item) => item.lifecycleStatus === status) || {};
    return { lifecycleStatus: status, label: ERP_OPERATING_LIFECYCLE[status], erpSkuCount: Number(row.erpSkuCount || 0),
      productCount: Number(row.productCount || 0), inventorySkuCount: Number(row.inventorySkuCount || 0),
      inventoryQuantity: Number(row.inventoryQuantity || 0), inventoryAmount: Number(row.inventoryAmount || 0) };
  });
  const count = (statuses) => items.filter((item) => statuses.includes(item.lifecycleStatus)).reduce((sum, item) => sum + item.erpSkuCount, 0);
  return {
    ready: true,
    calculatedAt: database.prepare("SELECT MAX(calculatedAt) value FROM operating_erp_set_members").get()?.value || null,
    total: items.reduce((sum, item) => sum + item.erpSkuCount, 0),
    operating: count(OPERATING_ERP_LIFECYCLE_STATUSES),
    nonOperating: count(NON_OPERATING_ERP_LIFECYCLE_STATUSES),
    items,
  };
}

export function queryErpOperatingLifecycle(input = {}, options = {}) {
  const database = options.database || getDatabase();
  const page = positiveInteger(input.page, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = positiveInteger(input.pageSize, 50);
  const showHistorical = enabled(input.includeHistorical);
  const conditions = ["m.erpSkuId IS NOT NULL", "s.currentState='active'"];
  const params = {};
  if (!showHistorical) conditions.push("m.lifecycleStatus IN ('active','active_dependency','sales_active')");
  if (text(input.lifecycleStatus)) { conditions.push("m.lifecycleStatus=@lifecycleStatus"); params.lifecycleStatus = text(input.lifecycleStatus); }
  if (text(input.keyword)) { conditions.push("(s.merchantSkuCode LIKE @keyword OR COALESCE(s.specificationName,'') LIKE @keyword OR COALESCE(g.goodsName,'') LIKE @keyword OR COALESCE(p.name,'') LIKE @keyword)"); params.keyword = `%${text(input.keyword)}%`; }
  if (enabled(input.inventoryOnly)) conditions.push("(COALESCE(i.stockNum,0)>0 OR COALESCE(i.availableSendStock,0)>0)");
  const where = conditions.join(" AND ");
  const from = `FROM operating_erp_set_members m JOIN erp_skus s ON s.id=m.erpSkuId JOIN erp_goods g ON g.id=s.erpGoodsId
    LEFT JOIN product_erp_mappings pm ON pm.erpSkuId=s.id AND pm.currentState='active' LEFT JOIN products p ON p.id=pm.productId
    LEFT JOIN (${latestInventorySql()}) i ON i.erpSkuId=s.id`;
  const total = Number(database.prepare(`SELECT COUNT(*) total ${from} WHERE ${where}`).get(params)?.total || 0);
  const items = database.prepare(`SELECT m.lifecycleStatus,m.sourceCount,m.firstSeenAt,m.lastSeenAt,m.calculatedAt,
      s.id erpSkuId,s.merchantSkuCode,s.specificationName,s.erpStatus,s.currentState,p.id productId,p.name productName,p.status productLifecycleStatus,
      COALESCE(i.stockNum,0) inventoryQuantity,COALESCE(i.availableSendStock,0) availableInventoryQuantity,
      COALESCE(i.inventoryCostAmount,0) inventoryAmount,i.businessDate inventoryDate,
      (SELECT group_concat(sourceType,',') FROM (SELECT DISTINCT e.sourceType FROM operating_erp_set_evidence e WHERE e.normalizedCode=m.normalizedCode AND e.active=1 ORDER BY e.sourceType)) sourceTypes
    ${from} WHERE ${where}
    ORDER BY CASE m.lifecycleStatus WHEN 'active' THEN 0 WHEN 'active_dependency' THEN 1 WHEN 'sales_active' THEN 2 WHEN 'archived' THEN 3 ELSE 4 END,
      COALESCE(i.inventoryCostAmount,0) DESC,s.merchantSkuCode LIMIT @limit OFFSET @offset`).all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });
  return { ready: lifecycleReady(database), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), includeHistorical: showHistorical,
    items: items.map((item) => ({ ...item, lifecycleLabel: ERP_OPERATING_LIFECYCLE[item.lifecycleStatus] || item.lifecycleStatus,
      sourceTypes: text(item.sourceTypes).split(",").filter(Boolean) })) };
}

export function listNonOperatingInventoryRisk(input = {}, options = {}) {
  const database = options.database || getDatabase();
  const limit = positiveInteger(input.limit, 100, 500);
  const items = database.prepare(`WITH latest_inventory AS (${latestInventorySql()})
    SELECT m.lifecycleStatus,s.id erpSkuId,s.merchantSkuCode,s.specificationName,p.id productId,p.name productName,
      i.businessDate inventoryDate,COALESCE(i.stockNum,0) inventoryQuantity,COALESCE(i.availableSendStock,0) availableInventoryQuantity,
      COALESCE(i.inventoryCostAmount,0) inventoryAmount
    FROM operating_erp_set_members m JOIN erp_skus s ON s.id=m.erpSkuId
    JOIN latest_inventory i ON i.erpSkuId=s.id
    LEFT JOIN product_erp_mappings pm ON pm.erpSkuId=s.id AND pm.currentState='active' LEFT JOIN products p ON p.id=pm.productId
    WHERE m.lifecycleStatus IN ('archived','external_unused') AND (COALESCE(i.stockNum,0)>0 OR COALESCE(i.availableSendStock,0)>0)
    ORDER BY COALESCE(i.inventoryCostAmount,0) DESC,COALESCE(i.stockNum,0) DESC,s.merchantSkuCode LIMIT ?`).all(limit);
  return { limit, total: Number(database.prepare(`WITH latest_inventory AS (${latestInventorySql()}) SELECT COUNT(*) total
      FROM operating_erp_set_members m JOIN latest_inventory i ON i.erpSkuId=m.erpSkuId
      WHERE m.lifecycleStatus IN ('archived','external_unused') AND (COALESCE(i.stockNum,0)>0 OR COALESCE(i.availableSendStock,0)>0)`).get()?.total || 0), items };
}

export function simulateErpOperatingLifecycleViews(options = {}) {
  const database = options.database || getDatabase();
  const summary = readErpOperatingLifecycleSummary({ database });
  const currentProducts = Number(database.prepare("SELECT COUNT(*) total FROM products").get()?.total || 0);
  const operatingProducts = Number(database.prepare(`SELECT COUNT(DISTINCT pm.productId) total FROM operating_erp_set_members m
    JOIN product_erp_mappings pm ON pm.erpSkuId=m.erpSkuId AND pm.currentState='active'
    WHERE m.lifecycleStatus IN ('active','active_dependency','sales_active')`).get()?.total || 0);
  const currentBundles = Number(database.prepare("SELECT COUNT(*) total FROM sales_objects WHERE objectType='bundle' AND status='active'").get()?.total || 0);
  const operatingBundles = Number(database.prepare(`SELECT COUNT(DISTINCT m.salesObjectId) total FROM operating_erp_set_members m
    JOIN sales_objects o ON o.id=m.salesObjectId AND o.objectType='bundle'
    WHERE m.salesObjectId IS NOT NULL AND m.lifecycleStatus IN ('active','sales_active')`).get()?.total || 0);
  const risk = listNonOperatingInventoryRisk({ limit: 100 }, { database });
  return {
    ready: summary.ready,
    erpSkus: { current: summary.total, operating: summary.operating, hidden: summary.nonOperating, reductionRatio: summary.total ? summary.nonOperating / summary.total : 0 },
    products: { current: currentProducts, operating: operatingProducts, historical: Math.max(0, currentProducts - operatingProducts), reductionRatio: currentProducts ? 1 - operatingProducts / currentProducts : 0 },
    bundles: { current: currentBundles, operating: operatingBundles, historical: Math.max(0, currentBundles - operatingBundles), reductionRatio: currentBundles ? 1 - operatingBundles / currentBundles : 0 },
    nonOperatingInventory: {
      erpSkuCount: risk.total,
      quantity: summary.items.filter((item) => NON_OPERATING_ERP_LIFECYCLE_STATUSES.includes(item.lifecycleStatus)).reduce((sum, item) => sum + item.inventoryQuantity, 0),
      amount: summary.items.filter((item) => NON_OPERATING_ERP_LIFECYCLE_STATUSES.includes(item.lifecycleStatus)).reduce((sum, item) => sum + item.inventoryAmount, 0),
    },
  };
}

export function getErpLifecycleSyncPolicy() {
  return {
    active: { masterData: "normal", inventory: "normal" },
    active_dependency: { masterData: "normal", inventory: "normal" },
    sales_active: { masterData: "normal", inventory: "normal" },
    archived: { masterData: "reduced_or_on_demand", inventory: "governance_only" },
    external_unused: { masterData: "excluded_from_daily", inventory: "governance_only" },
    appliedToProductionSync: false,
  };
}

export default readErpOperatingLifecycleSummary;
