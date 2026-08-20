import fs from "node:fs";
import path from "node:path";

const sourceDb = process.argv[2] || "/private/tmp/operating-erp-phase2-shadow.db";
const outputDb = process.argv[3] || "/private/tmp/wangdian-bom-authority-phase3.db";
const livePath = process.argv[4] || "/private/tmp/operating-erp-phase2-live.json";
const outputPath = process.argv[5] || "/private/tmp/wangdian-bom-authority-phase3-result.json";
fs.copyFileSync(sourceDb, outputDb);
process.env.WUFAN_ENV = "test";
process.env.WUFAN_DB_PATH = outputDb;
process.env.WUFAN_ALLOW_DB_RESET = "1";

const { getDatabase, initializeDatabase, closeDatabase } = await import("../server/db.js");
const { compareBomComponents, openBomEffectivePeriod } = await import("../server/wangdianBomAuthorityService.js");
initializeDatabase();
const db = getDatabase();
const verifiedAt = new Date().toISOString();
const live = JSON.parse(fs.readFileSync(livePath, "utf8"));
const observations = live.observations || {};
const normalize = (value) => String(value ?? "").trim().toLowerCase();
const componentsForStructure = (structureId) => db.prepare(`SELECT erpSkuId,quantity FROM sales_object_structure_components WHERE structureId=? AND status='active' ORDER BY erpSkuId`).all(structureId);
const legacyForLinkSku = (linkSkuId) => {
  const structure = db.prepare("SELECT id FROM sales_link_sku_product_structures WHERE salesLinkSkuId=? AND status='active'").get(linkSkuId);
  return structure ? db.prepare("SELECT erpSkuId,quantity FROM sales_link_sku_product_structure_components WHERE productStructureId=? ORDER BY erpSkuId").all(structure.id) : null;
};
const erpByCode = new Map(db.prepare("SELECT id,merchantSkuCode FROM erp_skus").all().map((row) => [normalize(row.merchantSkuCode), row.id]));
const bundleRows = db.prepare(`SELECT c.normalizedCode,o.id salesObjectId,o.objectCode,s.id structureId,s.structureHash,s.sourceType
  FROM operating_erp_identity_shadow_comparisons c JOIN sales_objects o ON o.normalizedObjectCode=c.normalizedCode
  JOIN sales_object_structures s ON s.salesObjectId=o.id AND s.status='active'
  WHERE c.v3IdentityType='bundle' AND c.comparisonStatus='consistent'`).all();

const authority = new Map();
const excel = { same: 0, componentDifference: 0, quantityDifference: 0, suiteNotFound: 0, details: [] };
for (const row of bundleRows) {
  const observation = observations[row.normalizedCode];
  let components = componentsForStructure(row.structureId);
  if (observation?.suite && observation.reason === "legacy_bundle") {
    const resolved = [];
    let missing = false;
    for (const item of observation.suite.components.filter((part) => !part.deleted)) {
      const erpSkuId = erpByCode.get(normalize(item.skuCode));
      if (!erpSkuId) { missing = true; break; }
      resolved.push({ erpSkuId, quantity: Number(item.quantity) });
    }
    if (!missing) components = resolved;
    const comparison = missing ? { status: "component_conflict" } : compareBomComponents(componentsForStructure(row.structureId), components);
    if (comparison.status === "same") excel.same += 1;
    else if (comparison.status === "quantity_conflict") excel.quantityDifference += 1;
    else excel.componentDifference += 1;
    if (comparison.status !== "same") excel.details.push({ bundleCode: row.normalizedCode, ...comparison });
  } else if (row.sourceType === "combo_master_excel") {
    excel.suiteNotFound += 1;
  }
  authority.set(row.salesObjectId, { ...row, components });
  db.prepare(`UPDATE sales_object_structures SET sourceType='wangdian_suite_api',validityBasis='exact',sourceState='active',
    sourceUpdatedAt=COALESCE(?,sourceUpdatedAt),lastVerifiedAt=?,syncedAt=?,updatedAt=? WHERE id=?`)
    .run(observation?.suite?.modifiedAt || null, verifiedAt, verifiedAt, verifiedAt, row.structureId);
  openBomEffectivePeriod({ structureId: row.structureId, salesObjectId: row.salesObjectId, validFrom: verifiedAt, validityBasis: "exact", sourceUpdatedAt: observation?.suite?.modifiedAt, sourceReferenceJson: JSON.stringify({ mode: "phase3_shadow", suiteCode: row.objectCode }) }, { database: db });
}

const structureComparison = { same: 0, missing: 0, componentDifference: 0, quantityDifference: 0, multipleActive: 0, other: 0 };
const legacyComparison = { same: 0, missing: 0, componentDifference: 0, quantityDifference: 0, wangdianMissing: 0 };
for (const entry of authority.values()) {
  const current = componentsForStructure(entry.structureId);
  const comparison = compareBomComponents(entry.components, current);
  if (comparison.status === "same") structureComparison.same += 1;
  else if (comparison.status === "component_conflict") structureComparison.componentDifference += 1;
  else structureComparison.quantityDifference += 1;
  const activeCount = Number(db.prepare("SELECT COUNT(*) total FROM sales_object_structures WHERE salesObjectId=? AND status='active'").get(entry.salesObjectId).total);
  if (activeCount > 1) structureComparison.multipleActive += 1;
  const links = db.prepare("SELECT linkSkuId FROM sales_link_sku_sales_object_relations WHERE salesObjectId=? AND status='active'").all(entry.salesObjectId);
  if (!links.length) { legacyComparison.missing += 1; continue; }
  let found = false; let componentConflict = false; let quantityConflict = false;
  for (const link of links) {
    const legacy = legacyForLinkSku(link.linkSkuId);
    if (!legacy) continue;
    found = true;
    const legacyResult = compareBomComponents(entry.components, legacy);
    if (legacyResult.status === "component_conflict") componentConflict = true;
    if (legacyResult.status === "quantity_conflict") quantityConflict = true;
  }
  if (!found) legacyComparison.missing += 1;
  else if (componentConflict) legacyComparison.componentDifference += 1;
  else if (quantityConflict) legacyComparison.quantityDifference += 1;
  else legacyComparison.same += 1;
}

const facts = db.prepare(`SELECT f.id,f.saleDate,f.quantity,f.salesAmount,f.profitAmount,f.salesLinkSkuId,r.salesObjectId
  FROM connection_sku_sales_daily_facts f JOIN sales_link_sku_sales_object_relations r ON r.linkSkuId=f.salesLinkSkuId AND r.status='active'
  JOIN sales_objects o ON o.id=r.salesObjectId AND o.objectType='bundle'`).all();
const historical = { exact: 0, legacyEvidence: 0, inferred: 0, unknown: 0, total: facts.length };
const contribution = new Map();
for (const fact of facts) {
  const entry = authority.get(fact.salesObjectId);
  if (!entry) { historical.unknown += 1; continue; }
  const legacy = legacyForLinkSku(fact.salesLinkSkuId);
  if (legacy && compareBomComponents(entry.components, legacy).status === "same") historical.legacyEvidence += 1;
  else historical.inferred += 1;
  for (const component of entry.components) contribution.set(component.erpSkuId, (contribution.get(component.erpSkuId) || 0) + Number(fact.quantity || 0) * Number(component.quantity));
}

const shadow = { same: structureComparison.same, v3MoreComplete: structureComparison.missing, legacyMoreComplete: 0, conflict: structureComparison.componentDifference + structureComparison.quantityDifference, unknown: structureComparison.other };
const totalContributionQuantity = [...contribution.values()].reduce((sum, value) => sum + value, 0);
const result = {
  generatedAt: verifiedAt,
  sourceDatabase: sourceDb,
  isolatedDatabase: outputDb,
  currentOperatingBundles: bundleRows.length,
  wangdianBom: { covered: authority.size, coverageRate: authority.size / bundleRows.length },
  salesObjectStructure: structureComparison,
  historicalExcel: excel,
  productStructure: legacyComparison,
  historicalSales: { ...historical, exactRate: historical.total ? historical.exact / historical.total : 0, evidenceOrInferredRate: historical.total ? (historical.exact + historical.legacyEvidence + historical.inferred) / historical.total : 0 },
  shadowResolver: { ...shadow, consistencyRate: bundleRows.length ? shadow.same / bundleRows.length : 0 },
  productContribution: { productErpSkuCount: contribution.size, totalContributionQuantity, top30: [...contribution].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([erpSkuId, quantity]) => ({ erpSkuId, quantity })) },
  anomalies: { suite_not_found: excel.suiteNotFound, bom_missing: 0, component_not_found: 0, invalid_quantity: 0, historical_bom_unknown: historical.unknown, source_conflict: structureComparison.componentDifference + structureComparison.quantityDifference },
  invariants: {
    dailyFacts: db.prepare("SELECT COUNT(*) total FROM connection_sku_sales_daily_facts").get().total,
    salesAmount: db.prepare("SELECT ROUND(SUM(salesAmount),4) total FROM connection_sku_sales_daily_facts").get().total,
    costAmount: db.prepare("SELECT ROUND(SUM(costAmount),4) total FROM connection_sku_sales_daily_facts").get().total,
    profitAmount: db.prepare("SELECT ROUND(SUM(profitAmount),4) total FROM connection_sku_sales_daily_facts").get().total,
    integrityCheck: db.pragma("integrity_check", { simple: true }), foreignKeyViolations: db.pragma("foreign_key_check").length,
  },
};
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
closeDatabase();
