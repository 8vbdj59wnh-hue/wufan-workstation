import { getDatabase } from "./db.js";
import { FORMAL_SALES_OBJECT_RESOLVER_SCOPES, resolveLinkSkuRelationsForRead } from "./capabilities/resolveLinkSkuRelationRead.js";

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

function latestSummaries(erpSkuIds, database) {
  const ids = [...new Set(erpSkuIds.filter(Boolean))];
  const rows = [];
  for (const group of chunk(ids)) {
    const marks = group.map(() => "?").join(",");
    rows.push(...database.prepare(`
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

function resolvedComponentsForLinks(salesLinkIds, database) {
  const ids = [...new Set(salesLinkIds.filter(Boolean))];
  const linkSkus = [];
  for (const group of chunk(ids)) {
    const marks = group.map(() => "?").join(",");
    linkSkus.push(...database.prepare(`
      SELECT s.id salesLinkSkuId,s.salesLinkId,s.specificationName
      FROM sales_link_skus s JOIN sales_links l ON l.id=s.salesLinkId
      WHERE s.salesLinkId IN (${marks})
        AND COALESCE(s.currentState,'active')='active'
        AND COALESCE(l.currentState,'active')='active'
      ORDER BY s.salesLinkId,s.id
    `).all(...group));
  }
  const resolved = {};
  for (const group of chunk(linkSkus.map((row) => row.salesLinkSkuId))) {
    Object.assign(resolved, resolveLinkSkuRelationsForRead({ salesLinkSkuIds: group }, {
      database, scope: "linkDetail", salesObjectResolverEnabled: true,
      enabledScopes: FORMAL_SALES_OBJECT_RESOLVER_SCOPES, logDifference: () => {},
    }).results);
  }
  const components = linkSkus.flatMap((linkSku) => {
    const relation = resolved[linkSku.salesLinkSkuId];
    if (!relation?.isUsable) return [];
    return relation.mappings.map((mapping) => ({
      salesLinkId: linkSku.salesLinkId, salesLinkSkuId: linkSku.salesLinkSkuId,
      specificationName: linkSku.specificationName, erpSkuId: mapping.erpSkuId,
      quantity: Number(mapping.quantity), relationshipShape: relation.relationshipShape,
      resolverSource: relation.resolverSource,
    }));
  });
  const erpSkuIds = [...new Set(components.map((row) => row.erpSkuId))];
  const productRefs = new Map();
  for (const group of chunk(erpSkuIds)) {
    const marks = group.map(() => "?").join(",");
    for (const row of database.prepare(`
      SELECT m.erpSkuId,m.productId,p.name productName
      FROM product_erp_mappings m JOIN products p ON p.id=m.productId
      WHERE m.erpSkuId IN (${marks}) AND COALESCE(m.currentState,'active')='active'
      ORDER BY m.erpSkuId,m.updatedAt DESC,m.id
    `).all(...group)) {
      const refs = productRefs.get(row.erpSkuId) ?? [];
      if (!refs.some((item) => item.productId === row.productId)) refs.push(row);
      productRefs.set(row.erpSkuId, refs);
    }
  }
  return components.map((component) => ({ ...component, products: productRefs.get(component.erpSkuId) ?? [] }));
}

function wangdianRowsForLinks(salesLinkIds, database) {
  const ids = [...new Set(salesLinkIds.filter(Boolean))];
  const components = resolvedComponentsForLinks(ids, database);
  const summaries = latestSummaries(components.map((row) => row.erpSkuId), database);
  const byLink = new Map(ids.map((id) => [id, []]));
  const seenByLinkErp = new Map();
  for (const component of components) {
    const summary = summaries.get(component.erpSkuId);
    if (!summary) continue;
    const identity = `${component.salesLinkId}|${component.erpSkuId}`;
    if (seenByLinkErp.has(identity)) {
      const existing = seenByLinkErp.get(identity);
      if (!existing.salesLinkSkuIds.includes(component.salesLinkSkuId)) existing.salesLinkSkuIds.push(component.salesLinkSkuId);
      existing.requiredQuantities[component.salesLinkSkuId] = component.quantity;
      continue;
    }
    const products = component.products;
    const row = {
      ...summary,
      skuCode: summary.merchantSkuCode,
      specificationName: component.specificationName || summary.specificationName,
      productId: products.length === 1 ? products[0].productId : null,
      productName: products.map((item) => item.productName).filter(Boolean).join("、") || null,
      productIds: products.map((item) => item.productId),
      productNames: products.map((item) => item.productName).filter(Boolean),
      salesLinkSkuId: component.salesLinkSkuId,
      salesLinkSkuIds: [component.salesLinkSkuId],
      componentQuantity: component.quantity,
      requiredQuantities: { [component.salesLinkSkuId]: component.quantity },
      relationshipShape: component.relationshipShape,
      resolverSource: component.resolverSource,
      sellableStockNum: Math.floor(numeric(summary.stockNum) / component.quantity),
      sellableAvailableStock: Math.floor(numeric(summary.availableSendStock) / component.quantity),
      ...risk(summary.stockNum, summary.availableSendStock, summary.salesMonth),
    };
    seenByLinkErp.set(identity, row);
    byLink.get(component.salesLinkId)?.push(row);
  }
  const availabilityByLink = new Map(ids.map((id) => [id, []]));
  const componentsByLinkSku = new Map();
  for (const component of components) {
    const rows = componentsByLinkSku.get(component.salesLinkSkuId) ?? [];
    rows.push({ component, summary: summaries.get(component.erpSkuId) });
    componentsByLinkSku.set(component.salesLinkSkuId, rows);
  }
  for (const [salesLinkSkuId, rows] of componentsByLinkSku) {
    if (!rows.length || rows.some((row) => !row.summary)) continue;
    const first = rows[0].component;
    availabilityByLink.get(first.salesLinkId)?.push({
      salesLinkSkuId, relationshipShape: first.relationshipShape,
      componentCount: rows.length,
      stockNum: Math.floor(Math.min(...rows.map((row) => numeric(row.summary.stockNum) / row.component.quantity))),
      availableSendStock: Math.floor(Math.min(...rows.map((row) => numeric(row.summary.availableSendStock) / row.component.quantity))),
      businessDate: rows.map((row) => row.summary.businessDate).filter(Boolean).sort().at(-1) ?? null,
    });
  }
  return { byLink, availabilityByLink, components };
}

function legacyRowsForLinks(salesLinkIds, database, resolvedComponents = []) {
  const ids = [...new Set(salesLinkIds.filter(Boolean))];
  const byLink = new Map(ids.map((id) => [id, []]));
  const componentsByLinkSku = new Map();
  for (const component of resolvedComponents) {
    const rows = componentsByLinkSku.get(component.salesLinkSkuId) ?? [];
    rows.push(component); componentsByLinkSku.set(component.salesLinkSkuId, rows);
  }
  for (const group of chunk(ids)) {
    const marks = group.map(() => "?").join(",");
    const rows = database.prepare(`
      SELECT s.salesLinkId,i.salesLinkSkuId,i.skuCode,i.businessDate,i.currentStock,i.availableStock,i.unitCost,i.salesVelocity,
        s.specificationName
      FROM connection_sku_inventory_facts i
      JOIN sales_link_skus s ON s.id=i.salesLinkSkuId
      WHERE s.salesLinkId IN (${marks})
        AND i.businessDate=(SELECT MAX(latest.businessDate) FROM connection_sku_inventory_facts latest WHERE latest.salesLinkSkuId=i.salesLinkSkuId)
    `).all(...group);
    for (const row of rows) {
      const salesMonth = numeric(row.salesVelocity) * 30;
      const products = [...new Map((componentsByLinkSku.get(row.salesLinkSkuId) ?? []).flatMap((component) => component.products).map((item) => [item.productId, item])).values()];
      byLink.get(row.salesLinkId)?.push({
        ...row,
        erpSkuId: null,
        productId: products.length === 1 ? products[0].productId : null,
        productName: products.map((item) => item.productName).filter(Boolean).join("、") || null,
        productIds: products.map((item) => item.productId),
        productNames: products.map((item) => item.productName).filter(Boolean),
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

export function readConnectionInventorySupplyMap(salesLinkIds, { includeCost = false, database = getDatabase() } = {}) {
  const ids = [...new Set(salesLinkIds.map(text).filter(Boolean))];
  const wangdian = wangdianRowsForLinks(ids, database);
  const missingIds = ids.filter((id) => !(wangdian.byLink.get(id)?.length));
  const legacy = legacyRowsForLinks(missingIds, database, wangdian.components);
  return new Map(ids.map((id) => {
    const source = wangdian.byLink.get(id)?.length ? "wangdian" : legacy.get(id)?.length ? "legacy_excel" : "none";
    const rawRows = source === "wangdian" ? wangdian.byLink.get(id) : source === "legacy_excel" ? legacy.get(id) : [];
    const rows = rawRows.map((row) => ({ ...row, costPrice: includeCost ? row.costPrice : null, inventoryCostAmount: includeCost ? row.inventoryCostAmount : null, costVisible: includeCost, source, sourceLabel: source === "wangdian" ? "旺店通" : "历史Excel" }));
    return [id, { summary: aggregate(rows, source, includeCost), rows, linkSkuAvailability: source === "wangdian" ? wangdian.availabilityByLink.get(id) ?? [] : [] }];
  }));
}

export function readConnectionInventorySupply(salesLinkId, options = {}) {
  return readConnectionInventorySupplyMap([salesLinkId], options).get(text(salesLinkId));
}

export function readProductInventorySupply(productId, { includeCost = false, database = getDatabase() } = {}) {
  return readProductInventorySupplyMap([productId], { includeCost, database }).get(text(productId));
}

export function readProductInventorySupplyMap(productIds, { includeCost = false, database = getDatabase() } = {}) {
  const ids = [...new Set(productIds.map(text).filter(Boolean))];
  if (!ids.length) return new Map();
  const relations = [];
  for (const group of chunk(ids)) {
    const marks = group.map(() => "?").join(",");
    relations.push(...database.prepare(`
      SELECT DISTINCT m.productId,s.id erpSkuId,s.merchantSkuCode,s.specificationName
      FROM product_erp_mappings m
      JOIN erp_skus s ON s.id=m.erpSkuId
      WHERE m.productId IN (${marks})
        AND m.erpSkuId IS NOT NULL
        AND COALESCE(m.currentState,'active')='active'
        AND COALESCE(s.currentState,'active')='active'
    `).all(...group));
  }
  const summaries = latestSummaries(relations.map((row) => row.erpSkuId), database);
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
