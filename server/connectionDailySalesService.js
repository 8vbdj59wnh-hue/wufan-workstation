import { getDatabase } from "./db.js";
import { queryDailySalesBySku, queryDailySalesSummary, queryDailySalesTrend } from "./capabilities/queryDailySales.js";
import { FORMAL_SALES_OBJECT_RESOLVER_SCOPES, resolveLinkSkuRelationsForRead } from "./capabilities/resolveLinkSkuRelationRead.js";

const clean = (value) => String(value ?? "").trim();

function placeholders(values) {
  return values.map(() => "?").join(",");
}

function dateRange(input = {}) {
  const endDate = clean(input.endDate) || new Date().toISOString().slice(0, 10);
  const startDate = clean(input.startDate) || (() => {
    const value = new Date(`${endDate}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() - 29);
    return value.toISOString().slice(0, 10);
  })();
  return { startDate, endDate };
}

function identityMaps(database, salesLinkSkuIds, erpSkuIds) {
  const linkSkus = salesLinkSkuIds.length
    ? database.prepare(`SELECT id,platformSkuId,specificationName FROM sales_link_skus WHERE id IN (${placeholders(salesLinkSkuIds)})`).all(...salesLinkSkuIds)
    : [];
  const erpSkus = erpSkuIds.length
    ? database.prepare(`SELECT id,merchantSkuCode,specificationName FROM erp_skus WHERE id IN (${placeholders(erpSkuIds)})`).all(...erpSkuIds)
    : [];
  return {
    linkSkus: new Map(linkSkus.map((item) => [item.id, item])),
    erpSkus: new Map(erpSkus.map((item) => [item.id, item])),
  };
}

export function getConnectionDailySalesPerformance(input = {}, options = {}) {
  const connectionId = clean(input.connectionId);
  if (!connectionId) throw new Error("链接档案不能为空。");
  const database = options.database || getDatabase();
  const connection = database.prepare("SELECT id,id salesLinkId FROM sales_links WHERE id=?").get(connectionId);
  if (!connection) throw new Error("链接档案不存在。");
  const range = dateRange(input);
  const capabilityOptions = { database };
  const summary = queryDailySalesSummary({ dimension: "salesLink", targetId: connection.salesLinkId, ...range }, capabilityOptions);
  const trend = queryDailySalesTrend({ dimension: "salesLink", targetId: connection.salesLinkId, ...range }, capabilityOptions);
  const bySku = queryDailySalesBySku({ salesLinkId: connection.salesLinkId, ...range }, capabilityOptions);
  const salesLinkSkuIds = bySku.items.map((item) => item.salesLinkSkuId);
  const relations = resolveLinkSkuRelationsForRead({ salesLinkSkuIds }, { database, scope: "linkDetail", salesObjectResolverEnabled: true, enabledScopes: FORMAL_SALES_OBJECT_RESOLVER_SCOPES }).results;
  const erpSkuIds = [...new Set(Object.values(relations).flatMap((relation) => relation.mappings.map((mapping) => mapping.erpSkuId)))];
  const identities = identityMaps(database, salesLinkSkuIds, erpSkuIds);
  const skuItems = bySku.items.map((item) => {
    const relation = relations[item.salesLinkSkuId];
    const linkSku = identities.linkSkus.get(item.salesLinkSkuId);
    return {
      ...item,
      salesLinkSkuName: linkSku?.specificationName || linkSku?.platformSkuId || "未命名链接SKU",
      relation: relation ? {
        relationStatus: relation.relationStatus,
        relationshipShape: relation.relationshipShape,
        isUsable: relation.isUsable,
        erpSkus: relation.mappings.map((mapping) => {
          const erpSku = identities.erpSkus.get(mapping.erpSkuId);
          return {
            erpSkuId: mapping.erpSkuId,
            merchantSkuCode: erpSku?.merchantSkuCode || null,
            name: erpSku?.specificationName || null,
            quantity: mapping.quantity,
          };
        }),
      } : { relationStatus: "not_found", relationshipShape: "none", isUsable: false, erpSkus: [] },
    };
  });
  const profitMargin = summary.hasData && summary.salesAmount !== 0 ? summary.profitAmount / summary.salesAmount : summary.hasData && summary.salesAmount === 0 ? 0 : null;
  return {
    connectionId,
    salesLinkId: connection.salesLinkId,
    range,
    summary: { ...summary, profitMargin },
    trend,
    bySku: { ...bySku, items: skuItems },
  };
}

export default getConnectionDailySalesPerformance;
