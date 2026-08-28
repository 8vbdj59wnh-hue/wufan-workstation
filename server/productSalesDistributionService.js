import { getDatabase } from "./db.js";
import { queryErpSkuContributions } from "./productContributionReadModel.js";

const presetDays = Object.freeze({ yesterday: 1, "7d": 7, "15d": 15, "30d": 30, "45d": 45, "60d": 60, "90d": 90 });
const currentOperatingStatuses = new Set(["active", "active_dependency", "sales_active"]);
const text = (value) => String(value ?? "").trim();

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayCount(startDate, endDate) {
  return Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000) + 1;
}

export function latestCompleteSalesDate(database) {
  if (database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='connection_import_batches'").get()) {
    const periodEnd = database.prepare(`
      SELECT b.periodEnd
      FROM connection_import_batches b
      WHERE b.sourceType='erp_sales_daily_preview'
        AND b.status IN ('completed','completed_with_exceptions')
        AND b.periodEnd IS NOT NULL
        AND EXISTS (SELECT 1 FROM connection_sku_sales_daily_facts f WHERE f.sourceBatchId=b.id)
      ORDER BY COALESCE(b.completedAt,b.updatedAt,b.createdAt) DESC,b.id DESC
      LIMIT 1
    `).get()?.periodEnd;
    if (periodEnd) return periodEnd;
  }
  return database.prepare("SELECT MAX(saleDate) periodEnd FROM connection_sku_sales_daily_facts").get()?.periodEnd || "";
}

export function resolveProductSalesDistributionRange(input = {}, anchorDate = "") {
  const preset = text(input.preset || "30d");
  if (preset === "custom") {
    const startDate = text(input.startDate);
    const endDate = text(input.endDate);
    if (!validDate(startDate) || !validDate(endDate) || startDate > endDate || dayCount(startDate, endDate) > 366) {
      throw new Error("产品销售结构时间范围无效，请选择不超过366天的正确日期范围。");
    }
    return { preset, startDate, endDate };
  }
  const days = presetDays[preset];
  if (!days) throw new Error("产品销售结构时间范围无效。");
  const endDate = validDate(anchorDate) ? anchorDate : addDays(new Date().toISOString().slice(0, 10), -1);
  return { preset, startDate: addDays(endDate, -(days - 1)), endDate };
}

function currentOperatingErpSkuIds(database) {
  if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='operating_erp_set_members'").get()) return null;
  const rows = database.prepare(`
    SELECT m.erpSkuId,m.lifecycleStatus
    FROM operating_erp_set_members m
    WHERE m.erpSkuId IS NOT NULL
  `).all();
  if (!rows.length) return null;
  const erpSkuIds = new Set();
  for (const row of rows) if (currentOperatingStatuses.has(text(row.lifecycleStatus))) erpSkuIds.add(row.erpSkuId);
  return erpSkuIds;
}

export function getProductSalesDistribution(input = {}, options = {}) {
  const database = options.database || getDatabase();
  const range = resolveProductSalesDistributionRange(input, latestCompleteSalesDate(database));
  const visible = options.visibleErpSkuIds ? new Set(options.visibleErpSkuIds.map(text).filter(Boolean)) : null;
  const includeHistorical = input.includeHistorical === true || ["1", "true"].includes(text(input.includeHistorical).toLowerCase());
  const operatingErpSkuIds = includeHistorical ? null : currentOperatingErpSkuIds(database);
  const products = database.prepare(`
    SELECT s.id erpSkuId,m.productId,
      COALESCE(NULLIF(profile.displayNameOverride,''),NULLIF(p.name,''),NULLIF(g.goodsName,''),s.merchantSkuCode) name,
      s.merchantSkuCode skuCode,COALESCE(NULLIF(s.mainImage,''),NULLIF(p.mainImage,'')) mainImage,
      COALESCE(NULLIF(profile.brandOverride,''),NULLIF(p.brand,''),g.brand) brand,
      COALESCE(NULLIF(profile.categoryOverride,''),NULLIF(p.category,''),g.category) category,
      COALESCE(NULLIF(profile.businessStatus,''),NULLIF(p.status,''),s.currentState) status,
      COALESCE(profile.ownerId,p.ownerId) ownerId,
      COALESCE(NULLIF(owner.name,''),'未分配') ownerName
    FROM erp_skus s
    JOIN erp_goods g ON g.id=s.erpGoodsId
    LEFT JOIN product_business_profiles profile ON profile.erpSkuId=s.id
    LEFT JOIN product_erp_mappings m ON m.id=(
      SELECT candidate.id FROM product_erp_mappings candidate
      WHERE candidate.erpSkuId=s.id AND candidate.currentState='active'
      ORDER BY candidate.updatedAt DESC,candidate.id DESC LIMIT 1
    )
    LEFT JOIN products p ON p.id=m.productId
    LEFT JOIN persons owner ON owner.id=COALESCE(profile.ownerId,p.ownerId)
    ORDER BY s.id
  `).all().filter((product) => (!visible || visible.has(product.erpSkuId)) && (!operatingErpSkuIds || operatingErpSkuIds.has(product.erpSkuId)));
  const contributions = products.length ? queryErpSkuContributions({
    periodStart: range.startDate,
    periodEnd: range.endDate,
    erpSkuIds: products.map((product) => product.erpSkuId),
  }, { database }) : { items: [] };
  const contributionByProduct = new Map(contributions.items.map((item) => [item.erpSkuId, item]));
  const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
  const rows = products.map((product) => {
    const contribution = contributionByProduct.get(product.erpSkuId);
    const directSalesAmount = contribution?.directSalesAmount ?? null;
    const hasPhysicalContribution = contribution?.directSalesQuantity !== null && contribution?.directSalesQuantity !== undefined
      || contribution?.bundleContributionQuantity !== null && contribution?.bundleContributionQuantity !== undefined;
    const totalPhysicalContribution = hasPhysicalContribution ? contribution?.totalPhysicalContribution ?? 0 : null;
    const hasSalesAmountData = directSalesAmount !== null;
    return {
      erpSkuId: product.erpSkuId,
      productId: product.productId || null,
      productName: product.name,
      skuCode: product.skuCode,
      mainImage: product.mainImage || "",
      brand: product.brand || null,
      category: product.category || null,
      status: product.status,
      ownerId: product.ownerId || null,
      ownerName: product.ownerName,
      directSalesAmount,
      directSalesQuantity: contribution?.directSalesQuantity ?? null,
      bundleContributionQuantity: contribution?.bundleContributionQuantity ?? null,
      totalPhysicalContribution,
      directFactCount: Number(contribution?.directFactCount || 0),
      bundleParticipationCount: Number(contribution?.bundleParticipationCount || 0),
      hasSalesAmountData,
      hasPhysicalContribution,
      noData: !hasSalesAmountData && !hasPhysicalContribution,
    };
  }).sort((left, right) => {
    if (left.hasSalesAmountData !== right.hasSalesAmountData) return left.hasSalesAmountData ? -1 : 1;
    if (left.hasSalesAmountData && Number(left.directSalesAmount) !== Number(right.directSalesAmount)) return Number(right.directSalesAmount) - Number(left.directSalesAmount);
    if (left.hasPhysicalContribution !== right.hasPhysicalContribution) return left.hasPhysicalContribution ? -1 : 1;
    if (left.hasPhysicalContribution && Number(left.totalPhysicalContribution) !== Number(right.totalPhysicalContribution)) return Number(right.totalPhysicalContribution) - Number(left.totalPhysicalContribution);
    return collator.compare(left.skuCode || left.productName, right.skuCode || right.productName);
  });
  const totalPositiveSalesAmount = rows.reduce((sum, row) => sum + (row.hasSalesAmountData ? Math.max(0, Number(row.directSalesAmount || 0)) : 0), 0);
  const items = rows.map((row, index) => ({
    ...row,
    rank: index + 1,
    groupIndex: Math.floor(index / 100) + 1,
    salesPercentage: row.hasSalesAmountData && totalPositiveSalesAmount > 0 ? Math.max(0, Number(row.directSalesAmount || 0)) / totalPositiveSalesAmount : null,
  }));
  const productsWithSalesAmount = items.filter((item) => item.hasSalesAmountData).length;
  const productsWithPhysicalContribution = items.filter((item) => item.hasPhysicalContribution).length;
  return {
    range,
    includeHistorical,
    items,
    summary: {
      totalProducts: items.length,
      productsWithSalesAmount,
      productsWithPhysicalContribution,
      productsWithoutSalesAmount: items.length - productsWithSalesAmount,
      productsWithoutAnyData: items.filter((item) => item.noData).length,
      totalDirectSalesAmount: productsWithSalesAmount ? items.reduce((sum, item) => sum + (item.hasSalesAmountData ? Number(item.directSalesAmount || 0) : 0), 0) : null,
      totalPhysicalContribution: productsWithPhysicalContribution ? items.reduce((sum, item) => sum + (item.hasPhysicalContribution ? Number(item.totalPhysicalContribution || 0) : 0), 0) : null,
      groupCount: Math.ceil(items.length / 100),
      hasData: productsWithSalesAmount > 0 || productsWithPhysicalContribution > 0,
    },
    definitions: {
      salesAmount: "Product仅归属Single直接销售事实；Bundle金额不分摊",
      physicalContribution: "Direct Sales Quantity + Bundle Contribution Quantity",
      identity: "ERP SKU",
      productScope: includeHistorical ? "全部 ERP SKU 资产" : "当前经营 ERP SKU",
      dataSource: "connection_sku_sales_daily_facts + Sales Object + ERP SKU",
      readOnly: true,
    },
  };
}
