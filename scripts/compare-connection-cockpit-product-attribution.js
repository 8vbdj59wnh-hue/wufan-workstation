import path from "node:path";
import Database from "better-sqlite3";
import { resolveLinkSkuErpRelations } from "../server/capabilities/resolveLinkSkuErpRelation.js";

const databasePath = path.resolve(String(process.env.COCKPIT_COMPARE_DB_PATH ?? "").trim());
if (!String(process.env.COCKPIT_COMPARE_DB_PATH ?? "").trim()) throw new Error("请通过 COCKPIT_COMPARE_DB_PATH 指定只读数据库快照。");
const database = new Database(databasePath, { readonly: true, fileMustExist: true });
const number = (value) => Number(value || 0);
const placeholders = (values) => values.map(() => "?").join(",");

const profiles = database.prepare("SELECT id,salesLinkId FROM connection_profiles ORDER BY id").all();
const salesLinkIds = [...new Set(profiles.map((row) => row.salesLinkId))];
if (!salesLinkIds.length) {
  console.log(JSON.stringify({ databasePath, legacy: {}, v2: {}, difference: {}, reasons: {} }, null, 2));
  database.close();
  process.exit(0);
}

const linkSql = placeholders(salesLinkIds);
const periodRows = database.prepare(`
  SELECT salesLinkId,periodStart,periodEnd
  FROM connection_sku_sales_facts
  WHERE salesLinkId IN (${linkSql})
  GROUP BY salesLinkId,periodStart,periodEnd
  ORDER BY salesLinkId,periodEnd DESC,periodStart DESC
`).all(...salesLinkIds);
const latestPeriodByLink = new Map();
for (const row of periodRows) if (!latestPeriodByLink.has(row.salesLinkId)) latestPeriodByLink.set(row.salesLinkId, `${row.periodStart}|${row.periodEnd}`);
const facts = database.prepare(`
  SELECT f.id,f.salesLinkId,f.salesLinkSkuId,f.periodStart,f.periodEnd,f.salesAmount,f.profitAmount,s.productId,s.currentState
  FROM connection_sku_sales_facts f
  JOIN sales_link_skus s ON s.id=f.salesLinkSkuId
  WHERE f.salesLinkId IN (${linkSql})
`).all(...salesLinkIds).filter((row) => `${row.periodStart}|${row.periodEnd}` === latestPeriodByLink.get(row.salesLinkId));

function summarize(attributionsByFact) {
  const productIds = new Set();
  const linkIds = new Set();
  let salesAmount = 0;
  let profitAmount = 0;
  let attributedFactCount = 0;
  for (const fact of facts) {
    const attributions = attributionsByFact.get(fact.id) ?? [];
    if (attributions.length) attributedFactCount += 1;
    for (const attribution of attributions) {
      productIds.add(attribution.productId);
      linkIds.add(fact.salesLinkId);
      salesAmount += number(fact.salesAmount) * attribution.share;
      profitAmount += number(fact.profitAmount) * attribution.share;
    }
  }
  return { salesAmount, profitAmount, productCount: productIds.size, linkCount: linkIds.size, attributedFactCount };
}

const legacyByFact = new Map(facts.filter((fact) => fact.productId).map((fact) => [fact.id, [{ productId: fact.productId, share: 1 }]]));
const salesLinkSkuIds = [...new Set(facts.filter((fact) => fact.currentState === "active").map((fact) => fact.salesLinkSkuId))];
const relations = {};
for (let offset = 0; offset < salesLinkSkuIds.length; offset += 500) {
  Object.assign(relations, resolveLinkSkuErpRelations({ salesLinkSkuIds: salesLinkSkuIds.slice(offset, offset + 500) }, { database }).results);
}
const productMappings = database.prepare("SELECT erpSkuId,productId FROM product_erp_mappings WHERE currentState='active' AND erpSkuId IS NOT NULL").all();
const productByErpSku = new Map(productMappings.map((row) => [row.erpSkuId, row.productId]));
const v2BySku = new Map();
for (const salesLinkSkuId of salesLinkSkuIds) {
  const relation = relations[salesLinkSkuId];
  if (!relation?.isUsable) continue;
  const totalQuantity = relation.mappings.reduce((sum, mapping) => sum + number(mapping.quantity), 0);
  if (!(totalQuantity > 0)) continue;
  const quantityByProduct = new Map();
  for (const mapping of relation.mappings) {
    const productId = productByErpSku.get(mapping.erpSkuId);
    if (!productId) continue;
    quantityByProduct.set(productId, (quantityByProduct.get(productId) || 0) + number(mapping.quantity));
  }
  const attributions = [...quantityByProduct].map(([productId, quantity]) => ({ productId, share: quantity / totalQuantity }));
  if (attributions.length) v2BySku.set(salesLinkSkuId, attributions);
}
const v2ByFact = new Map(facts.filter((fact) => v2BySku.has(fact.salesLinkSkuId)).map((fact) => [fact.id, v2BySku.get(fact.salesLinkSkuId)]));

const reasons = new Map();
function addReason(reason, fact, legacy, v2, relation) {
  const current = reasons.get(reason) ?? { factCount: 0, salesAmount: 0, profitAmount: 0, linkIds: new Set(), examples: [] };
  current.factCount += 1;
  current.salesAmount += number(fact.salesAmount);
  current.profitAmount += number(fact.profitAmount);
  current.linkIds.add(fact.salesLinkId);
  if (reason !== "unchanged_single_product" && current.examples.length < 5) current.examples.push({
    factId: fact.id,
    salesLinkId: fact.salesLinkId,
    salesLinkSkuId: fact.salesLinkSkuId,
    salesAmount: number(fact.salesAmount),
    profitAmount: number(fact.profitAmount),
    legacyProductIds: legacy.map((row) => row.productId),
    v2Products: v2,
    relationStatus: relation?.relationStatus ?? "missing",
    mappings: (relation?.mappings ?? []).map((mapping) => ({
      erpSkuId: mapping.erpSkuId,
      quantity: mapping.quantity,
      productId: productByErpSku.get(mapping.erpSkuId) ?? null,
    })),
  });
  reasons.set(reason, current);
}
for (const fact of facts) {
  const legacy = legacyByFact.get(fact.id) ?? [];
  const v2 = v2ByFact.get(fact.id) ?? [];
  const relation = relations[fact.salesLinkSkuId];
  if (legacy.length === 1 && v2.length === 1 && legacy[0].productId === v2[0].productId && v2[0].share === 1) addReason("unchanged_single_product", fact, legacy, v2, relation);
  else if (legacy.length && !v2.length) addReason(relation?.isUsable ? "legacy_only_missing_product_mapping" : `legacy_only_relation_${relation?.relationStatus ?? "missing"}`, fact, legacy, v2, relation);
  else if (!legacy.length && v2.length) addReason("v2_only_legacy_product_missing", fact, legacy, v2, relation);
  else if (v2.length > 1 || v2.some((row) => row.share !== 1)) addReason("v2_weighted_multi_product", fact, legacy, v2, relation);
  else if (legacy.length && v2.length && legacy[0].productId !== v2[0].productId) addReason("product_attribution_changed", fact, legacy, v2, relation);
  else addReason("unattributed_both", fact, legacy, v2, relation);
}

const legacy = summarize(legacyByFact);
const v2 = summarize(v2ByFact);
const difference = {
  salesAmount: v2.salesAmount - legacy.salesAmount,
  profitAmount: v2.profitAmount - legacy.profitAmount,
  productCount: v2.productCount - legacy.productCount,
  linkCount: v2.linkCount - legacy.linkCount,
};
const relationStatusCounts = Object.values(relations).reduce((counts, relation) => {
  counts[relation.relationStatus] = (counts[relation.relationStatus] || 0) + 1;
  return counts;
}, {});
const outputReasons = Object.fromEntries([...reasons].map(([reason, row]) => [reason, {
  factCount: row.factCount,
  salesAmount: row.salesAmount,
  profitAmount: row.profitAmount,
  linkCount: row.linkIds.size,
  examples: row.examples,
}]));

console.log(JSON.stringify({
  databasePath,
  scope: { connectionCount: profiles.length, latestFactCount: facts.length, latestLinkCount: latestPeriodByLink.size },
  legacy,
  v2,
  difference,
  amountsExactlyEqual: difference.salesAmount === 0 && difference.profitAmount === 0,
  relationStatusCounts,
  reasons: outputReasons,
}, null, 2));
database.close();
