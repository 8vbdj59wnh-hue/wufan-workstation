import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [databasePath, manifestPath, outputPath] = process.argv.slice(2).map((value) => value ? path.resolve(value) : value);
if (!databasePath || !manifestPath || !outputPath) throw new Error("参数不足：数据库、应用清单和结果文件均为必填。");
process.env.WUFAN_DB_PATH = databasePath;

const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
const { resolveLinkSkuErpRelations } = await import("../server/capabilities/resolveLinkSkuErpRelation.js");

const stableId = (...parts) => crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
const canonical = (rows = []) => [...rows].map((row) => ({ erpSkuId: String(row.erpSkuId), quantity: Number(row.quantity) })).sort((a, b) => a.erpSkuId.localeCompare(b.erpSkuId));
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const count = (db, table, where = "") => Number(db.prepare(`SELECT COUNT(*) total FROM ${table} ${where}`).get().total || 0);
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function baseline(db) {
  return {
    structures: count(db, "sales_link_sku_product_structures"),
    activeStructures: count(db, "sales_link_sku_product_structures", "WHERE status='active'"),
    components: count(db, "sales_link_sku_product_structure_components"),
    activeMappings: count(db, "sales_link_sku_erp_mappings", "WHERE currentState='active'"),
    dailyFacts: count(db, "connection_sku_sales_daily_facts"),
    erpUsages: count(db, "erp_sku_business_usages"),
    erpSkus: count(db, "erp_skus"),
    products: count(db, "products"),
    productMappings: count(db, "product_erp_mappings"),
    comboGroups: count(db, "sales_link_sku_combo_groups"),
    comboComponents: count(db, "sales_link_sku_combo_group_components"),
  };
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const readyItems = manifest.items.filter((item) => item.classification === "ready_to_apply");
const blockedItems = manifest.items.filter((item) => item.classification !== "ready_to_apply");
assert(manifest.contractVersion === "1.0", "应用清单版本不兼容。");
assert(manifest.items.length === 10949 && readyItems.length === 10938 && blockedItems.length === 11, "应用清单数量不符合7-7E冻结范围。");
assert(blockedItems.every((item) => item.classification === "incomplete"), "清单包含未授权异常分类。");
assert(readyItems.every((item) => item.components.length > 0 && item.components.every((component) => Number(component.quantity) > 0)), "ready清单存在空组件或非法quantity。");

try {
  initializeDatabase({ reset: false });
  const db = getDatabase();
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 30000");
  const before = baseline(db);
  const reviewer = db.prepare("SELECT id FROM persons WHERE status='active' ORDER BY CASE WHEN authRole='admin' THEN 0 ELSE 1 END,id LIMIT 1").get();
  assert(reviewer?.id, "生产环境缺少有效审核人。");
  const timestamp = new Date().toISOString();
  const batchCode = "PHASE-7-7E-PRODUCTION";
  const batchId = `product-structure-application-${stableId(batchCode)}`;
  const existingBatch = db.prepare("SELECT id FROM product_structure_application_batches WHERE batchCode=?").get(batchCode);
  if (existingBatch) {
    assert(existingBatch.id === batchId && before.activeStructures === 10938 && before.activeMappings === 43302, "同批次生产状态不符合幂等基线，停止执行。");
  } else {
    assert(before.structures === 0 && before.activeMappings === 20819 && before.dailyFacts === 3668 && before.erpUsages === 86, "生产基线已漂移，停止应用。");
  }

  const insertPreparation = db.transaction(() => {
    db.prepare(`INSERT INTO product_structure_application_batches
      (id,batchCode,sourceType,sourceFileHashesJson,status,createdBy,createdAt,updatedAt)
      VALUES (?,?,? ,?,'reviewed',?,?,?)`).run(batchId, batchCode, "product_master_data_integration", JSON.stringify(manifest.sourceFiles || {}), reviewer.id, timestamp, timestamp);
    const insertStructure = db.prepare(`INSERT INTO sales_link_sku_product_structures
      (id,salesLinkSkuId,structureCode,structureHash,status,sourceType,sourceFileHash,sourceReferenceJson,createdBy,createdAt,updatedAt)
      VALUES (?,?,?,?, 'pending_review','product_master_data_integration',?,?,?, ?,?)`);
    const insertComponent = db.prepare(`INSERT INTO sales_link_sku_product_structure_components
      (id,productStructureId,erpSkuId,quantity,sortOrder,sourceType,sourceReferenceJson,createdAt,updatedAt)
      VALUES (?,?,?,?,?,'product_master_data_integration','{}',?,?)`);
    const insertItem = db.prepare(`INSERT INTO product_structure_application_items
      (id,applicationBatchId,productStructureId,salesLinkSkuId,classification,approvalStatus,relationshipShape,sourceTypesJson,currentMappingsJson,targetComponentsJson,componentDiffJson,impactSalesAmount,impactProfitAmount,reviewedBy,reviewedAt,reviewNote,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const item of manifest.items) {
      const components = canonical(item.components);
      const hash = crypto.createHash("sha256").update(components.map((component) => `${component.erpSkuId}:${component.quantity.toFixed(6)}`).join("|")).digest("hex");
      const structureId = `product-structure-${stableId(batchId, item.salesLinkSkuId, hash)}`;
      insertStructure.run(structureId, item.salesLinkSkuId, `PS-${stableId(item.salesLinkSkuId, hash).slice(0, 16)}`, hash, manifest.manifestSha256 || null, JSON.stringify({ applicationBatchId: batchId, sourcePhase: manifest.sourcePhase }), reviewer.id, timestamp, timestamp);
      components.forEach((component, index) => insertComponent.run(`product-structure-component-${stableId(structureId, component.erpSkuId)}`, structureId, component.erpSkuId, component.quantity, index + 1, timestamp, timestamp));
      const ready = item.classification === "ready_to_apply";
      insertItem.run(`product-structure-application-item-${stableId(batchId, item.salesLinkSkuId)}`, batchId, structureId, item.salesLinkSkuId, item.classification, ready ? "approved" : "blocked", item.relationshipShape, JSON.stringify(["product_master_data_integration"]), "[]", JSON.stringify(components), JSON.stringify({ added: components, removed: [], quantityChanged: [], unchangedCount: 0 }), Number(item.impactSalesAmount || 0), Number(item.impactProfitAmount || 0), ready ? reviewer.id : null, ready ? timestamp : null, ready ? "Phase 7-7E生产应用批准" : "Phase 7-7D缺组件继续阻断", timestamp, timestamp);
    }
  });
  if (!existingBatch) insertPreparation();

  const outcomes = { applied: 0, idempotent: 0, structure_upgrade: 0, conflict: 0, incomplete: 11, failed: 0, rolledBack: 0 };
  let addedMappings = 0;
  const applyOne = db.transaction((item) => {
    const structure = db.prepare(`SELECT s.* FROM product_structure_application_items i
      JOIN sales_link_sku_product_structures s ON s.id=i.productStructureId
      WHERE i.applicationBatchId=? AND i.salesLinkSkuId=?`).get(batchId, item.salesLinkSkuId);
    const target = db.prepare("SELECT erpSkuId,quantity FROM sales_link_sku_product_structure_components WHERE productStructureId=? ORDER BY sortOrder,id").all(structure.id);
    const live = db.prepare("SELECT * FROM sales_link_sku_erp_mappings WHERE salesLinkSkuId=? AND currentState='active' ORDER BY erpSkuId,id").all(item.salesLinkSkuId);
    if (live.length) {
      if (structure.status === "active" && equal(live, target) && live.every((mapping) => mapping.productStructureId === structure.id)) return { outcome: "idempotent", added: 0 };
      const liveSet = new Set(canonical(live).map((mapping) => `${mapping.erpSkuId}:${mapping.quantity}`));
      const targetSet = new Set(canonical(target).map((mapping) => `${mapping.erpSkuId}:${mapping.quantity}`));
      if ([...liveSet].every((key) => targetSet.has(key))) return { outcome: "structure_upgrade", added: 0 };
      return { outcome: "conflict", added: 0 };
    }
    const now = new Date().toISOString();
    const insert = db.prepare(`INSERT INTO sales_link_sku_erp_mappings
      (id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,productStructureId,createdAt,updatedAt)
      VALUES (?,?,?,?,?,'active','product_structure_application',?,?,?)`);
    for (const component of target) insert.run(`sales-link-sku-erp-map-${crypto.randomUUID()}`, item.salesLinkSkuId, component.erpSkuId, target.length > 1 ? "combo" : "single", component.quantity, structure.id, now, now);
    db.prepare("UPDATE sales_link_sku_product_structures SET status='active',reviewedBy=?,reviewedAt=?,activatedAt=?,updatedAt=? WHERE id=? AND status='pending_review'").run(reviewer.id, now, now, now, structure.id);
    const applicationItem = db.prepare("SELECT id FROM product_structure_application_items WHERE applicationBatchId=? AND salesLinkSkuId=?").get(batchId, item.salesLinkSkuId);
    db.prepare(`INSERT INTO product_structure_application_audits
      (id,applicationItemId,productStructureId,executionMode,outcome,oldMappingsSnapshotJson,generatedMappingsJson,appliedBy,appliedAt,createdAt)
      VALUES (?,?,?,'production','applied','[]',?,?,?,?)`).run(`product-structure-application-audit-${crypto.randomUUID()}`, applicationItem.id, structure.id, JSON.stringify(target), reviewer.id, now, now);
    return { outcome: "applied", added: target.length };
  });

  for (const item of readyItems) {
    try {
      const result = applyOne(item);
      outcomes[result.outcome] += 1;
      addedMappings += result.added;
    } catch (error) {
      outcomes.failed += 1;
      const applicationItem = db.prepare("SELECT id,productStructureId FROM product_structure_application_items WHERE applicationBatchId=? AND salesLinkSkuId=?").get(batchId, item.salesLinkSkuId);
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO product_structure_application_audits
        (id,applicationItemId,productStructureId,executionMode,outcome,oldMappingsSnapshotJson,generatedMappingsJson,errorMessage,appliedBy,appliedAt,createdAt)
        VALUES (?,?,?,'production','rolled_back','[]','[]',?,?,?,?)`).run(`product-structure-application-audit-${crypto.randomUUID()}`, applicationItem.id, applicationItem.productStructureId, String(error.message), reviewer.id, now, now);
      outcomes.rolledBack += 1;
    }
  }

  const expectedApplied = existingBatch ? 0 : 10938;
  const expectedIdempotent = existingBatch ? 10938 : 0;
  assert(outcomes.applied === expectedApplied && outcomes.idempotent === expectedIdempotent && outcomes.structure_upgrade === 0 && outcomes.conflict === 0 && outcomes.failed === 0, `生产应用结果不符合冻结范围：${JSON.stringify(outcomes)}`);
  const appliedIds = readyItems.map((item) => item.salesLinkSkuId);
  const resolved = resolveLinkSkuErpRelations({ salesLinkSkuIds: appliedIds }, { database: db }).results;
  const resolverFailures = appliedIds.filter((id) => resolved[id]?.relationStatus !== "active_complete" || !resolved[id]?.isUsable || !resolved[id]?.productStructure?.isConsistent);
  const setMismatches = db.prepare(`SELECT s.id FROM sales_link_sku_product_structures s WHERE s.status='active' AND (
    (SELECT COUNT(*) FROM sales_link_sku_product_structure_components c WHERE c.productStructureId=s.id)<>(SELECT COUNT(*) FROM sales_link_sku_erp_mappings m WHERE m.productStructureId=s.id AND m.currentState='active')
    OR EXISTS (SELECT 1 FROM sales_link_sku_product_structure_components c WHERE c.productStructureId=s.id AND NOT EXISTS (SELECT 1 FROM sales_link_sku_erp_mappings m WHERE m.productStructureId=s.id AND m.currentState='active' AND m.erpSkuId=c.erpSkuId AND m.quantity=c.quantity)))`).all();
  const secondPassIdempotent = appliedIds.filter((id) => resolved[id]?.relationStatus === "active_complete" && resolved[id]?.productStructure?.isConsistent).length;
  const after = baseline(db);
  const integrityCheck = db.pragma("integrity_check", { simple: true });
  const foreignKeyErrors = db.pragma("foreign_key_check");
  assert(resolverFailures.length === 0 && setMismatches.length === 0 && secondPassIdempotent === 10938, "生产关系一致性或幂等验证失败。");
  assert(integrityCheck === "ok" && foreignKeyErrors.length === 0, "生产数据库完整性检查失败。");
  assert(after.dailyFacts === before.dailyFacts && after.erpUsages === before.erpUsages && after.erpSkus === before.erpSkus && after.products === before.products && after.productMappings === before.productMappings && after.comboGroups === before.comboGroups && after.comboComponents === before.comboComponents, "受保护数据发生变化。");
  const result = { success: true, batchId, reviewerId: reviewer.id, manifestSha256: manifest.manifestSha256, before, outcomes, addedMappings, after, resolverFailures: resolverFailures.length, setMismatches: setMismatches.length, secondPassIdempotent, integrityCheck, foreignKeyCheckErrors: foreignKeyErrors.length };
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  closeDatabase();
}
