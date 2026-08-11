import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const [databasePath, outputPath, projectRoot] = process.argv.slice(2);
if (!databasePath || !outputPath || !projectRoot) throw new Error("参数不足。");
const require = createRequire(path.join(path.resolve(projectRoot), "package.json"));
const Database = require("better-sqlite3");
const database = new Database(path.resolve(databasePath));
database.pragma("foreign_keys = ON");

const scope = [
  "sales-link-sku-064e594f8eaf25dc7b5b582b", "sales-link-sku-08e672eba6705c4bd904c315",
  "sales-link-sku-116a62f941b9acc42c4c4f86", "sales-link-sku-781e3814a1c9c70cffa7beb3",
  "sales-link-sku-ae40a9f5beda39dd81b45cf3", "sales-link-sku-c42b0c171e4898431ab582e1",
  "sales-link-sku-eaa19ccd7c79770db910226d", "sales-link-sku-f84989d920e5df4d8a46a009",
];
const stableId = (...parts) => crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
const uuid = () => crypto.randomUUID();
const canonical = (rows) => [...rows].map(({ erpSkuId, quantity }) => ({ erpSkuId, quantity: Number(quantity) })).sort((a, b) => a.erpSkuId.localeCompare(b.erpSkuId));
const hashRows = (sql) => crypto.createHash("sha256").update(JSON.stringify(database.prepare(sql).all())).digest("hex");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

try {
  const reviewer = database.prepare("SELECT id FROM persons WHERE status='active' ORDER BY CASE WHEN authRole='admin' THEN 0 ELSE 1 END,id LIMIT 1").get();
  assert(reviewer, "缺少管理员审核人。");
  const protectedBefore = {
    dailyFacts: database.prepare("SELECT COUNT(*) total FROM connection_sku_sales_daily_facts").get().total,
    erpSkuHash: hashRows("SELECT * FROM erp_skus ORDER BY id"),
    componentHash: hashRows("SELECT * FROM sales_link_sku_product_structure_components ORDER BY id"),
    productHash: hashRows("SELECT * FROM products ORDER BY id"),
  };
  const mappingBefore = database.prepare("SELECT COUNT(*) total FROM sales_link_sku_erp_mappings WHERE currentState='active'").get().total;
  const structureBefore = database.prepare("SELECT COUNT(*) total FROM sales_link_sku_product_structures WHERE status='active'").get().total;
  const placeholders = scope.map(() => "?").join(",");
  const blocked = database.prepare(`SELECT i.*,s.status structureStatus FROM product_structure_application_items i
    JOIN sales_link_sku_product_structures s ON s.id=i.productStructureId
    WHERE i.salesLinkSkuId IN (${placeholders}) AND i.classification='incomplete' AND i.approvalStatus='blocked'
    ORDER BY i.createdAt DESC`).all(...scope);
  const latest = new Map(); for (const item of blocked) if (!latest.has(item.salesLinkSkuId)) latest.set(item.salesLinkSkuId, item);
  assert(latest.size === 8, `恢复范围异常：${latest.size}`);

  const batchCode = "PHASE-8-6-AUTO-RECOVERABLE-PRODUCTION";
  const batchId = `product-structure-application-${stableId(batchCode)}`;
  const now = new Date().toISOString();
  if (!database.prepare("SELECT 1 FROM product_structure_application_batches WHERE batchCode=?").get(batchCode)) {
    database.transaction(() => {
      database.prepare(`INSERT INTO product_structure_application_batches
        (id,batchCode,sourceType,sourceFileHashesJson,status,createdBy,createdAt,updatedAt)
        VALUES (?,?,?,'{}','pending_review',?,?,?)`).run(batchId, batchCode, "non_product_evidence_reclassification", reviewer.id, now, now);
      const insert = database.prepare(`INSERT INTO product_structure_application_items
        (id,applicationBatchId,productStructureId,salesLinkSkuId,classification,approvalStatus,relationshipShape,sourceTypesJson,currentMappingsJson,targetComponentsJson,componentDiffJson,impactSalesAmount,impactProfitAmount,reviewedBy,reviewedAt,reviewNote,createdAt,updatedAt)
        VALUES (?,?,?,?,?,'approved',?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const salesLinkSkuId of scope) {
        const source = latest.get(salesLinkSkuId);
        assert(source.structureStatus === "pending_review", `${salesLinkSkuId}结构状态已变化。`);
        const components = canonical(database.prepare(`SELECT c.erpSkuId,c.quantity FROM sales_link_sku_product_structure_components c
          JOIN erp_skus e ON e.id=c.erpSkuId WHERE c.productStructureId=?`).all(source.productStructureId));
        const mappings = canonical(database.prepare("SELECT erpSkuId,quantity FROM sales_link_sku_erp_mappings WHERE salesLinkSkuId=? AND currentState='active'").all(salesLinkSkuId));
        assert(components.length && components.every((c) => c.quantity > 0), `${salesLinkSkuId}组件无效。`);
        assert(mappings.length === 0, `${salesLinkSkuId}已有active mapping。`);
        insert.run(`product-structure-application-item-${stableId(batchId, salesLinkSkuId)}`, batchId, source.productStructureId,
          salesLinkSkuId, "ready_to_apply", source.relationshipShape, source.sourceTypesJson, "[]", JSON.stringify(components),
          JSON.stringify({ added: components, removed: [], quantityChanged: [], unchangedCount: 0 }), Number(source.impactSalesAmount || 0),
          Number(source.impactProfitAmount || 0), reviewer.id, now, "Phase 8-6非商品隔离重算后批准恢复", now, now);
      }
    })();
  }

  const items = database.prepare("SELECT * FROM product_structure_application_items WHERE applicationBatchId=? ORDER BY salesLinkSkuId").all(batchId);
  assert(items.length === 8 && items.every((i) => i.approvalStatus === "approved" && i.classification === "ready_to_apply"), "审批批次状态异常。");
  const outcomes = [];
  for (const item of items) {
    const components = canonical(database.prepare("SELECT erpSkuId,quantity FROM sales_link_sku_product_structure_components WHERE productStructureId=?").all(item.productStructureId));
    const active = database.prepare("SELECT * FROM sales_link_sku_erp_mappings WHERE salesLinkSkuId=? AND currentState='active' ORDER BY erpSkuId,id").all(item.salesLinkSkuId);
    const structure = database.prepare("SELECT status FROM sales_link_sku_product_structures WHERE id=?").get(item.productStructureId);
    if (JSON.stringify(canonical(active)) === JSON.stringify(components) && active.every((m) => m.productStructureId === item.productStructureId) && structure?.status === "active") {
      outcomes.push({ salesLinkSkuId: item.salesLinkSkuId, outcome: "idempotent", generatedMappingCount: 0 }); continue;
    }
    assert(active.length === 0 && structure?.status === "pending_review", `${item.salesLinkSkuId}运行时状态漂移。`);
    const outcome = database.transaction(() => {
      const ts = new Date().toISOString();
      const mappingType = components.length > 1 ? "combo" : "single";
      const insertMapping = database.prepare(`INSERT INTO sales_link_sku_erp_mappings
        (id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,productStructureId,createdAt,updatedAt)
        VALUES (?,?,?,?,?,'active','product_structure_application',?,?,?)`);
      const generated = [];
      for (const component of components) {
        const id = `sales-link-sku-erp-map-${uuid()}`;
        insertMapping.run(id, item.salesLinkSkuId, component.erpSkuId, mappingType, component.quantity, item.productStructureId, ts, ts);
        generated.push({ id, ...component, mappingType });
      }
      const changed = database.prepare(`UPDATE sales_link_sku_product_structures SET status='active',reviewedBy=?,reviewedAt=COALESCE(reviewedAt,?),activatedAt=?,updatedAt=?
        WHERE id=? AND status='pending_review'`).run(reviewer.id, ts, ts, ts, item.productStructureId);
      assert(changed.changes === 1, `${item.salesLinkSkuId}结构激活失败。`);
      database.prepare(`INSERT INTO product_structure_application_audits
        (id,applicationItemId,productStructureId,executionMode,outcome,oldMappingsSnapshotJson,generatedMappingsJson,appliedBy,appliedAt,createdAt)
        VALUES (?,?,?,'production','applied','[]',?,?,?,?)`).run(`product-structure-application-audit-${uuid()}`, item.id, item.productStructureId, JSON.stringify(generated), reviewer.id, ts, ts);
      return { salesLinkSkuId: item.salesLinkSkuId, outcome: "applied", generatedMappingCount: generated.length };
    })();
    outcomes.push(outcome);
  }

  const mismatches = [];
  for (const salesLinkSkuId of scope) {
    const structure = database.prepare("SELECT id,status FROM sales_link_sku_product_structures WHERE salesLinkSkuId=? AND status='active'").get(salesLinkSkuId);
    const components = canonical(database.prepare("SELECT erpSkuId,quantity FROM sales_link_sku_product_structure_components WHERE productStructureId=?").all(structure?.id));
    const mappings = canonical(database.prepare("SELECT erpSkuId,quantity FROM sales_link_sku_erp_mappings WHERE salesLinkSkuId=? AND currentState='active' AND productStructureId=?").all(salesLinkSkuId, structure?.id));
    if (!structure || JSON.stringify(components) !== JSON.stringify(mappings)) mismatches.push(salesLinkSkuId);
  }
  assert(mismatches.length === 0, `结构与mapping不一致：${mismatches.join(",")}`);
  const protectedAfter = {
    dailyFacts: database.prepare("SELECT COUNT(*) total FROM connection_sku_sales_daily_facts").get().total,
    erpSkuHash: hashRows("SELECT * FROM erp_skus ORDER BY id"), componentHash: hashRows("SELECT * FROM sales_link_sku_product_structure_components ORDER BY id"),
    productHash: hashRows("SELECT * FROM products ORDER BY id"),
  };
  assert(JSON.stringify(protectedBefore) === JSON.stringify(protectedAfter), "受保护数据发生变化。");
  const integrity = database.pragma("integrity_check", { simple: true }); const fk = database.pragma("foreign_key_check");
  assert(integrity === "ok" && fk.length === 0, "完整性检查失败。");
  const result = { success: true, batchId, outcomes, appliedCount: outcomes.filter((o) => o.outcome === "applied").length,
    idempotentCount: outcomes.filter((o) => o.outcome === "idempotent").length, generatedMappingCount: outcomes.reduce((s, o) => s + o.generatedMappingCount, 0),
    activeMappingBefore: mappingBefore, activeMappingAfter: database.prepare("SELECT COUNT(*) total FROM sales_link_sku_erp_mappings WHERE currentState='active'").get().total,
    activeStructureBefore: structureBefore, activeStructureAfter: database.prepare("SELECT COUNT(*) total FROM sales_link_sku_product_structures WHERE status='active'").get().total,
    protectedBefore, protectedAfter, integrityCheck: integrity, foreignKeyCheckErrors: fk.length };
  fs.writeFileSync(path.resolve(outputPath), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { database.close(); }
