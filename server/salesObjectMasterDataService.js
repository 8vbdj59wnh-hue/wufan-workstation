import crypto from "node:crypto";
import { getDatabase } from "./db.js";

const clean = (value) => String(value ?? "").trim().replace(/\.0+$/u, "");
const normalized = (value) => clean(value).toLowerCase();
const stableId = (prefix, value) => `${prefix}-${crypto.createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

export function generateSalesObjectsFromMasterData({ platformRows = [], comboRows = [], source = "wangdian", sourceBatchId = null, timestamp = new Date().toISOString() } = {}, options = {}) {
  const database = options.database || getDatabase();
  const erpByCode = new Map();
  for (const row of database.prepare("SELECT id,merchantSkuCode FROM erp_skus WHERE currentState='active'").all()) {
    const key = normalized(row.merchantSkuCode); const values = erpByCode.get(key) || []; values.push(row); erpByCode.set(key, values);
  }
  const comboDefinitions = new Map();
  for (const row of comboRows) {
    const parent = normalized(row.parentCode ?? row["商家编码"]); const child = normalized(row.childCode ?? row["单品商家编码"]); const quantity = Number(clean(row.quantity ?? row["数量"]));
    if (!parent || !child || !(quantity > 0)) continue;
    const values = comboDefinitions.get(parent) || new Map(); values.set(child, (values.get(child) || 0) + quantity); comboDefinitions.set(parent, values);
  }
  const linkSkuCandidates = new Map();
  for (const row of database.prepare(`SELECT x.id linkSkuId,x.platformSkuId,x.platformSkuCode,l.platformGoodsId FROM sales_link_skus x JOIN sales_links l ON l.id=x.salesLinkId WHERE x.currentState='active'`).all()) {
    for (const key of [`${normalized(row.platformGoodsId)}|${normalized(row.platformSkuId)}|${normalized(row.platformSkuCode)}`, `${normalized(row.platformGoodsId)}|${normalized(row.platformSkuId)}|`]) {
      const values = linkSkuCandidates.get(key) || []; values.push(row); linkSkuCandidates.set(key, values);
    }
  }
  const plannedObjects = new Map(); const plannedRelations = new Map(); const unresolved = [];
  for (const [index, row] of platformRows.entries()) {
    const goodsId = normalized(row.platformGoodsId ?? row["货品ID"]); const platformSkuId = normalized(row.platformSkuId ?? row["规格ID"]);
    const code = normalized(row.objectCode ?? row.merchantSkuCode ?? row["平台规格编码"]); const kind = clean(row.objectType ?? row.systemGoodsType ?? row["系统货品"]);
    if (!goodsId || !platformSkuId || !code || !["single", "bundle", "单品", "组合装"].includes(kind)) { unresolved.push({ rowNumber: index + 2, reason: "source_not_product_or_identity_missing" }); continue; }
    const candidates = linkSkuCandidates.get(`${goodsId}|${platformSkuId}|${code}`) || linkSkuCandidates.get(`${goodsId}|${platformSkuId}|`) || [];
    const unique = [...new Map(candidates.map((item) => [item.linkSkuId, item])).values()];
    if (unique.length !== 1) { unresolved.push({ rowNumber: index + 2, reason: unique.length ? "link_sku_ambiguous" : "link_sku_unmatched" }); continue; }
    const objectType = ["single", "单品"].includes(kind) ? "single" : "bundle"; const components = []; let reason = "";
    if (objectType === "single") {
      const erps = erpByCode.get(code) || []; if (erps.length === 1) components.push({ erpSkuId: erps[0].id, quantity: 1 }); else reason = erps.length ? "erp_sku_ambiguous" : "erp_sku_missing";
    } else {
      const definition = comboDefinitions.get(code); if (!definition?.size) reason = "combo_definition_missing";
      else for (const [childCode, quantity] of definition) { const erps = erpByCode.get(childCode) || []; if (erps.length !== 1) { reason = erps.length ? "component_erp_ambiguous" : "component_erp_missing"; break; } components.push({ erpSkuId: erps[0].id, quantity }); }
    }
    if (reason) { unresolved.push({ rowNumber: index + 2, linkSkuId: unique[0].linkSkuId, objectCode: code, reason }); continue; }
    components.sort((a, b) => a.erpSkuId.localeCompare(b.erpSkuId)); const signature = JSON.stringify(components.map((item) => [item.erpSkuId, Number(item.quantity)]));
    const objectKey = `${source}|${code}`; const existing = plannedObjects.get(objectKey);
    if (existing && (existing.objectType !== objectType || existing.signature !== signature)) { unresolved.push({ rowNumber: index + 2, linkSkuId: unique[0].linkSkuId, objectCode: code, reason: "sales_object_source_conflict" }); continue; }
    const object = existing || { id: stableId("sales-object", objectKey), objectCode: clean(row.objectCode ?? row.merchantSkuCode ?? row["平台规格编码"]), normalizedObjectCode: code, objectType, source, sourceType: objectType === "bundle" ? "combo_master_excel" : "platform_goods_excel", sourceCode: code, components, signature };
    plannedObjects.set(objectKey, object); const prior = plannedRelations.get(unique[0].linkSkuId);
    if (prior && prior.id !== object.id) { unresolved.push({ rowNumber: index + 2, linkSkuId: unique[0].linkSkuId, objectCode: code, reason: "link_sku_multiple_sales_objects" }); continue; }
    plannedRelations.set(unique[0].linkSkuId, object);
  }
  const reviewer = options.reviewerId || database.prepare("SELECT id FROM persons ORDER BY id LIMIT 1").get()?.id;
  if (!reviewer) throw new Error("缺少Sales Object历史生成审核身份。");
  const counts = { objectsCreated: 0, objectsExisting: 0, structuresCreated: 0, structuresExisting: 0, componentsCreated: 0, relationsCreated: 0, relationsExisting: 0 };
  database.transaction(() => {
    const insertObject = database.prepare(`INSERT OR IGNORE INTO sales_objects (id,objectCode,normalizedObjectCode,objectType,source,sourceType,sourceCode,sourceBatchId,status,firstSeenAt,lastSeenAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,'active',?,?,?,?)`);
    const insertStructure = database.prepare(`INSERT OR IGNORE INTO sales_object_structures (id,salesObjectId,version,structureHash,effectiveFrom,status,sourceType,sourceBatchId,sourceReferenceJson,reviewedBy,reviewedAt,activatedAt,createdAt,updatedAt) VALUES (?,?,?,?,?,'draft',?,?,'{}',?,?,?,?,?)`);
    const activate = database.prepare("UPDATE sales_object_structures SET status='active' WHERE id=? AND status='draft'");
    const insertComponent = database.prepare(`INSERT OR IGNORE INTO sales_object_structure_components (id,structureId,salesObjectId,erpSkuId,quantity,sortOrder,status,sourceType,sourceReferenceJson,createdAt,updatedAt) VALUES (?,?,?,?,?,?,'active',?,'{}',?,?)`);
    const insertRelation = database.prepare(`INSERT OR IGNORE INTO sales_link_sku_sales_object_relations (id,linkSkuId,salesObjectId,effectiveFrom,status,sourceType,sourceBatchId,sourceReferenceJson,reviewedBy,reviewedAt,createdAt,updatedAt) VALUES (?,?,?,?,'active','platform_goods_excel',?,'{}',?,?,?,?)`);
    for (const object of plannedObjects.values()) {
      const objectResult = insertObject.run(object.id, object.objectCode, object.normalizedObjectCode, object.objectType, object.source, object.sourceType, object.sourceCode, sourceBatchId, timestamp, timestamp, timestamp, timestamp); counts.objectsCreated += objectResult.changes; counts.objectsExisting += objectResult.changes ? 0 : 1;
      const structureId = stableId("sales-object-structure", `${object.id}|${object.signature}`); const structureResult = insertStructure.run(structureId, object.id, 1, hash(object.signature), timestamp, object.sourceType, sourceBatchId, reviewer, timestamp, timestamp, timestamp, timestamp); counts.structuresCreated += structureResult.changes; counts.structuresExisting += structureResult.changes ? 0 : 1;
      if (structureResult.changes) {
        object.components.forEach((component, sortOrder) => { counts.componentsCreated += insertComponent.run(stableId("sales-object-component", `${structureId}|${component.erpSkuId}`), structureId, object.id, component.erpSkuId, component.quantity, sortOrder + 1, object.sourceType, timestamp, timestamp).changes; });
        activate.run(structureId);
      }
    }
    for (const [linkSkuId, object] of plannedRelations) { const result = insertRelation.run(stableId("sales-link-sku-sales-object", linkSkuId), linkSkuId, object.id, timestamp, sourceBatchId, reviewer, timestamp, timestamp, timestamp); counts.relationsCreated += result.changes; counts.relationsExisting += result.changes ? 0 : 1; }
  }).immediate();
  return { planned: { salesObjects: plannedObjects.size, relations: plannedRelations.size, unresolved: unresolved.length }, counts, unresolved };
}

export default generateSalesObjectsFromMasterData;
