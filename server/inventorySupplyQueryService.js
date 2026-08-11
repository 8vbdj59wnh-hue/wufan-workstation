import { getDatabase } from "./db.js";

const text = (value) => String(value ?? "").trim();
const chunk = (items, size = 500) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
const numeric = (value) => Number(value || 0);

function risk(stockNum, availableSendStock, salesMonth, hasData = true) {
  if (!hasData) return { stockDays: null, stockRisk: "no_data", stockStatus: "暂无数据" };
  const stock = numeric(stockNum);
  const available = numeric(availableSendStock);
  const sales = numeric(salesMonth);
  if (available <= 0 && sales > 0) return { stockDays: 0, stockRisk: "out", stockStatus: "缺货风险" };
  if (sales <= 0 && stock > 0) return { stockDays: null, stockRisk: "no_sales", stockStatus: "无动销" };
  if (sales <= 0) return { stockDays: null, stockRisk: "no_data", stockStatus: "暂无数据" };
  const stockDays = available / (sales / 30);
  return { stockDays, stockRisk: stockDays < 7 ? "low" : stockDays > 90 ? "high" : "normal", stockStatus: stockDays < 7 ? "库存偏低" : stockDays > 90 ? "库存偏高" : "库存正常" };
}

function latestSummaries(erpSkuIds) {
  const ids = [...new Set(erpSkuIds.filter(Boolean))];
  const rows = [];
  for (const group of chunk(ids)) {
    const marks = group.map(() => "?").join(",");
    rows.push(...getDatabase().prepare(`
      SELECT d.*,s.merchantSkuCode,s.specificationName
      FROM erp_sku_inventory_daily_summaries d
      JOIN erp_skus s ON s.id=d.erpSkuId
      WHERE d.erpSkuId IN (${marks})
        AND d.businessDate=(SELECT MAX(latest.businessDate) FROM erp_sku_inventory_daily_summaries latest WHERE latest.erpSkuId=d.erpSkuId)
    `).all(...group));
  }
  return new Map(rows.map((row) => [row.erpSkuId, row]));
}

function aggregate(rows, source, includeCost) {
  if (!rows.length) return { source, sourceLabel: source === "wangdian" ? "旺店通" : source === "legacy_excel" ? "历史Excel" : "暂无数据", businessDate: null, skuCount: 0, warehouseCount: 0, stockNum: null, availableSendStock: null, sales7d: null, salesMonth: null, sales90d: null, costPrice: null, inventoryCostAmount: null, ...risk(0, 0, 0, false) };
  const stockNum = rows.reduce((sum, row) => sum + numeric(row.stockNum), 0);
  const availableSendStock = rows.reduce((sum, row) => sum + numeric(row.availableSendStock), 0);
  const sales7d = rows.reduce((sum, row) => sum + numeric(row.sales7d), 0);
  const salesMonth = rows.reduce((sum, row) => sum + numeric(row.salesMonth), 0);
  const sales90d = rows.reduce((sum, row) => sum + numeric(row.sales90d), 0);
  const inventoryCostAmount = includeCost && rows.every((row) => row.inventoryCostAmount !== null && row.inventoryCostAmount !== undefined)
    ? rows.reduce((sum, row) => sum + numeric(row.inventoryCostAmount), 0) : null;
  const costPrice = includeCost && stockNum > 0 && inventoryCostAmount !== null ? inventoryCostAmount / stockNum : null;
  return {
    source,
    sourceLabel: source === "wangdian" ? "旺店通" : "历史Excel",
    businessDate: rows.map((row) => row.businessDate).filter(Boolean).sort().at(-1) ?? null,
    skuCount: rows.length,
    warehouseCount: rows.reduce((sum, row) => sum + numeric(row.warehouseCount), 0),
    stockNum,
    availableSendStock,
    sales7d,
    salesMonth,
    sales90d,
    costPrice,
    inventoryCostAmount,
    ...risk(stockNum, availableSendStock, salesMonth),
  };
}

function wangdianRowsForLinks(salesLinkIds) {
  const ids = [...new Set(salesLinkIds.filter(Boolean))];
  const relations = [];
  for (const group of chunk(ids)) {
    const marks = group.map(() => "?").join(",");
    relations.push(...getDatabase().prepare(`
      SELECT s.salesLinkId,s.erpSkuId,s.specificationName,p.id productId,p.name productName
      FROM sales_link_skus s
      LEFT JOIN products p ON p.id=s.productId
      WHERE s.salesLinkId IN (${marks}) AND s.erpSkuId IS NOT NULL AND COALESCE(s.currentState,'active')='active'
    `).all(...group));
  }
  const summaries = latestSummaries(relations.map((row) => row.erpSkuId));
  const byLink = new Map(ids.map((id) => [id, []]));
  const seen = new Set();
  for (const relation of relations) {
    const identity = `${relation.salesLinkId}|${relation.erpSkuId}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const summary = summaries.get(relation.erpSkuId);
    if (!summary) continue;
    byLink.get(relation.salesLinkId)?.push({
      ...summary,
      skuCode: summary.merchantSkuCode,
      specificationName: relation.specificationName || summary.specificationName,
      productId: relation.productId,
      productName: relation.productName,
      ...risk(summary.stockNum, summary.availableSendStock, summary.salesMonth),
    });
  }
  return byLink;
}

function legacyRowsForLinks(salesLinkIds) {
  const ids = [...new Set(salesLinkIds.filter(Boolean))];
  const byLink = new Map(ids.map((id) => [id, []]));
  for (const group of chunk(ids)) {
    const marks = group.map(() => "?").join(",");
    const rows = getDatabase().prepare(`
      SELECT s.salesLinkId,i.salesLinkSkuId,i.skuCode,i.businessDate,i.currentStock,i.availableStock,i.unitCost,i.salesVelocity,
        s.specificationName,p.id productId,p.name productName
      FROM connection_sku_inventory_facts i
      JOIN sales_link_skus s ON s.id=i.salesLinkSkuId
      LEFT JOIN products p ON p.id=s.productId
      WHERE s.salesLinkId IN (${marks})
        AND i.businessDate=(SELECT MAX(latest.businessDate) FROM connection_sku_inventory_facts latest WHERE latest.salesLinkSkuId=i.salesLinkSkuId)
    `).all(...group);
    for (const row of rows) {
      const salesMonth = numeric(row.salesVelocity) * 30;
      byLink.get(row.salesLinkId)?.push({
        ...row,
        erpSkuId: null,
        warehouseCount: 0,
        stockNum: numeric(row.currentStock),
        availableSendStock: numeric(row.availableStock),
        costPrice: row.unitCost,
        inventoryCostAmount: row.unitCost === null || row.unitCost === undefined ? null : numeric(row.currentStock) * numeric(row.unitCost),
        sales7d: null,
        salesMonth,
        sales90d: null,
        ...risk(row.currentStock, row.availableStock, salesMonth),
      });
    }
  }
  return byLink;
}

export function readConnectionInventorySupplyMap(salesLinkIds, { includeCost = false } = {}) {
  const ids = [...new Set(salesLinkIds.map(text).filter(Boolean))];
  const wangdian = wangdianRowsForLinks(ids);
  const missingIds = ids.filter((id) => !(wangdian.get(id)?.length));
  const legacy = legacyRowsForLinks(missingIds);
  return new Map(ids.map((id) => {
    const source = wangdian.get(id)?.length ? "wangdian" : legacy.get(id)?.length ? "legacy_excel" : "none";
    const rawRows = source === "wangdian" ? wangdian.get(id) : source === "legacy_excel" ? legacy.get(id) : [];
    const rows = rawRows.map((row) => ({ ...row, costPrice: includeCost ? row.costPrice : null, inventoryCostAmount: includeCost ? row.inventoryCostAmount : null, costVisible: includeCost, source, sourceLabel: source === "wangdian" ? "旺店通" : "历史Excel" }));
    return [id, { summary: aggregate(rows, source, includeCost), rows }];
  }));
}

export function readConnectionInventorySupply(salesLinkId, options = {}) {
  return readConnectionInventorySupplyMap([salesLinkId], options).get(text(salesLinkId));
}

export function readProductInventorySupply(productId, { includeCost = false } = {}) {
  return readProductInventorySupplyMap([productId], { includeCost }).get(text(productId));
}

export function readProductInventorySupplyMap(productIds, { includeCost = false } = {}) {
  const ids = [...new Set(productIds.map(text).filter(Boolean))];
  if (!ids.length) return new Map();
  const relations = [];
  for (const group of chunk(ids)) {
    const marks = group.map(() => "?").join(",");
    relations.push(...getDatabase().prepare(`
      SELECT DISTINCT m.productId,s.id erpSkuId,s.merchantSkuCode,s.specificationName
      FROM product_erp_mappings m
      JOIN erp_skus s ON lower(s.merchantSkuCode)=lower(m.merchantSkuCode)
      WHERE m.productId IN (${marks})
        AND COALESCE(m.currentState,'active')='active'
        AND COALESCE(s.currentState,'active')='active'
    `).all(...group));
  }
  const summaries = latestSummaries(relations.map((row) => row.erpSkuId));
  const rowsByProduct = new Map(ids.map((id) => [id, []]));
  for (const relation of relations) {
    const summary = summaries.get(relation.erpSkuId);
    if (!summary) continue;
    rowsByProduct.get(relation.productId)?.push({
      ...summary,
      skuCode: summary.merchantSkuCode,
      costPrice: includeCost ? summary.costPrice : null,
      inventoryCostAmount: includeCost ? summary.inventoryCostAmount : null,
      costVisible: includeCost,
      source: "wangdian",
      sourceLabel: "旺店通",
      ...risk(summary.stockNum, summary.availableSendStock, summary.salesMonth),
    });
  }
  return new Map(ids.map((id) => {
    const rows = rowsByProduct.get(id) ?? [];
    return [id, { summary: aggregate(rows, rows.length ? "wangdian" : "none", includeCost), rows }];
  }));
}
