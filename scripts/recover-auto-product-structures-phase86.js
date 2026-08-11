import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [databasePath, outputPath, suppliedProjectRoot] = process.argv.slice(2);
if (!databasePath || !outputPath) throw new Error("用法：node scripts/recover-auto-product-structures-phase86.js <database> <output.json>");

process.env.WUFAN_DB_PATH = path.resolve(databasePath);
const projectRoot = suppliedProjectRoot
  ? path.resolve(suppliedProjectRoot)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectImport = (relativePath) => import(pathToFileURL(path.join(projectRoot, relativePath)).href);

const { closeDatabase, getDatabase, initializeDatabase } = await projectImport("server/db.js");
const {
  applyApprovedProductStructureApplication,
  reviewProductStructureApplicationItem,
} = await projectImport("server/productStructureApplicationApprovalService.js");
const { resolveLinkSkuErpRelations } = await projectImport("server/capabilities/resolveLinkSkuErpRelation.js");

const SALES_LINK_SKU_IDS = [
  "sales-link-sku-064e594f8eaf25dc7b5b582b",
  "sales-link-sku-08e672eba6705c4bd904c315",
  "sales-link-sku-116a62f941b9acc42c4c4f86",
  "sales-link-sku-781e3814a1c9c70cffa7beb3",
  "sales-link-sku-ae40a9f5beda39dd81b45cf3",
  "sales-link-sku-c42b0c171e4898431ab582e1",
  "sales-link-sku-eaa19ccd7c79770db910226d",
  "sales-link-sku-f84989d920e5df4d8a46a009",
];

const stableId = (...parts) => crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
const canonical = (rows) => [...rows].map(({ erpSkuId, quantity }) => ({ erpSkuId, quantity: Number(quantity) })).sort((a, b) => a.erpSkuId.localeCompare(b.erpSkuId));
const hashRows = (database, sql) => crypto.createHash("sha256").update(JSON.stringify(database.prepare(sql).all())).digest("hex");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

initializeDatabase({ reset: false });
const database = getDatabase();
database.pragma("foreign_keys = ON");

try {
  const reviewer = database.prepare("SELECT id FROM persons WHERE status='active' ORDER BY CASE WHEN authRole='admin' THEN 0 ELSE 1 END,id LIMIT 1").get();
  assert(reviewer, "生产库没有可用管理员审核人。");

  const protectedBefore = {
    dailyFacts: database.prepare("SELECT COUNT(*) total FROM connection_sku_sales_daily_facts").get().total,
    erpSkuHash: hashRows(database, "SELECT * FROM erp_skus ORDER BY id"),
    componentHash: hashRows(database, "SELECT * FROM sales_link_sku_product_structure_components ORDER BY id"),
    productHash: hashRows(database, "SELECT * FROM products ORDER BY id"),
  };
  const mappingBefore = database.prepare("SELECT COUNT(*) total FROM sales_link_sku_erp_mappings WHERE currentState='active'").get().total;
  const activeStructureBefore = database.prepare("SELECT COUNT(*) total FROM sales_link_sku_product_structures WHERE status='active'").get().total;

  const placeholders = SALES_LINK_SKU_IDS.map(() => "?").join(",");
  const sourceItems = database.prepare(`SELECT i.*,s.status structureStatus
    FROM product_structure_application_items i
    JOIN sales_link_sku_product_structures s ON s.id=i.productStructureId
    WHERE i.salesLinkSkuId IN (${placeholders}) AND i.classification='incomplete' AND i.approvalStatus='blocked'
    ORDER BY i.createdAt DESC`).all(...SALES_LINK_SKU_IDS);
  const latestBySku = new Map();
  for (const item of sourceItems) if (!latestBySku.has(item.salesLinkSkuId)) latestBySku.set(item.salesLinkSkuId, item);
  assert(latestBySku.size === 8, `固定范围中blocked incomplete对象不是8个：${latestBySku.size}`);

  const timestamp = new Date().toISOString();
  const batchCode = "PHASE-8-6-AUTO-RECOVERABLE-PRODUCTION";
  const batchId = `product-structure-application-${stableId(batchCode)}`;
  const existingBatch = database.prepare("SELECT id FROM product_structure_application_batches WHERE batchCode=?").get(batchCode);
  if (!existingBatch) {
    database.transaction(() => {
      database.prepare(`INSERT INTO product_structure_application_batches
        (id,batchCode,sourceType,sourceFileHashesJson,status,createdBy,createdAt,updatedAt)
        VALUES (?,?,?,'{}','pending_review',?,?,?)`).run(batchId, batchCode, "non_product_evidence_reclassification", reviewer.id, timestamp, timestamp);
      const insertItem = database.prepare(`INSERT INTO product_structure_application_items
        (id,applicationBatchId,productStructureId,salesLinkSkuId,classification,approvalStatus,relationshipShape,sourceTypesJson,currentMappingsJson,targetComponentsJson,componentDiffJson,impactSalesAmount,impactProfitAmount,createdAt,updatedAt)
        VALUES (?,?,?,?,?,'pending',?,?,?,?,?,?,?,?,?)`);
      for (const salesLinkSkuId of SALES_LINK_SKU_IDS) {
        const source = latestBySku.get(salesLinkSkuId);
        assert(source.structureStatus === "pending_review", `${salesLinkSkuId}结构状态不是pending_review。`);
        const components = canonical(database.prepare(`SELECT c.erpSkuId,c.quantity
          FROM sales_link_sku_product_structure_components c JOIN erp_skus e ON e.id=c.erpSkuId
          WHERE c.productStructureId=? ORDER BY c.erpSkuId`).all(source.productStructureId));
        assert(components.length > 0 && components.every((item) => item.quantity > 0), `${salesLinkSkuId}组件不完整。`);
        const activeMappings = canonical(database.prepare("SELECT erpSkuId,quantity FROM sales_link_sku_erp_mappings WHERE salesLinkSkuId=? AND currentState='active'").all(salesLinkSkuId));
        assert(activeMappings.length === 0, `${salesLinkSkuId}已存在active mapping，停止恢复。`);
        insertItem.run(
          `product-structure-application-item-${stableId(batchId, salesLinkSkuId)}`,
          batchId,
          source.productStructureId,
          salesLinkSkuId,
          "ready_to_apply",
          source.relationshipShape,
          source.sourceTypesJson,
          JSON.stringify(activeMappings),
          JSON.stringify(components),
          JSON.stringify({ added: components, removed: [], quantityChanged: [], unchangedCount: 0 }),
          Number(source.impactSalesAmount || 0),
          Number(source.impactProfitAmount || 0),
          timestamp,
          timestamp,
        );
      }
    })();
  }

  const items = database.prepare("SELECT * FROM product_structure_application_items WHERE applicationBatchId=? ORDER BY salesLinkSkuId").all(batchId);
  assert(items.length === 8, `恢复批次对象不是8个：${items.length}`);
  const outcomes = [];
  for (const item of items) {
    if (item.approvalStatus === "pending") reviewProductStructureApplicationItem(item.id, {
      decision: "approved",
      reviewedBy: reviewer.id,
      reviewNote: "Phase 8-6：按已确认非商品隔离口径排除0013/0016后，权威组件结构完整，批准恢复。",
    }, { database });
    outcomes.push(applyApprovedProductStructureApplication(item.id, { appliedBy: reviewer.id }, { database }));
  }

  const resolved = resolveLinkSkuErpRelations({ salesLinkSkuIds: SALES_LINK_SKU_IDS }, { database }).results;
  const failures = [];
  for (const salesLinkSkuId of SALES_LINK_SKU_IDS) {
    const relation = resolved[salesLinkSkuId];
    if (relation?.relationStatus !== "active_complete" || !relation?.isUsable || !relation?.productStructure?.isConsistent) failures.push(salesLinkSkuId);
    const structure = database.prepare("SELECT id FROM sales_link_sku_product_structures WHERE salesLinkSkuId=? AND status='active'").get(salesLinkSkuId);
    const components = canonical(database.prepare("SELECT erpSkuId,quantity FROM sales_link_sku_product_structure_components WHERE productStructureId=?").all(structure?.id));
    const mappings = canonical(database.prepare("SELECT erpSkuId,quantity FROM sales_link_sku_erp_mappings WHERE salesLinkSkuId=? AND currentState='active'").all(salesLinkSkuId));
    if (JSON.stringify(components) !== JSON.stringify(mappings)) failures.push(`${salesLinkSkuId}:set_mismatch`);
  }
  assert(failures.length === 0, `恢复后关系校验失败：${failures.join(",")}`);

  const protectedAfter = {
    dailyFacts: database.prepare("SELECT COUNT(*) total FROM connection_sku_sales_daily_facts").get().total,
    erpSkuHash: hashRows(database, "SELECT * FROM erp_skus ORDER BY id"),
    componentHash: hashRows(database, "SELECT * FROM sales_link_sku_product_structure_components ORDER BY id"),
    productHash: hashRows(database, "SELECT * FROM products ORDER BY id"),
  };
  assert(JSON.stringify(protectedBefore) === JSON.stringify(protectedAfter), "受保护数据发生变化。");
  const integrity = database.pragma("integrity_check", { simple: true });
  const foreignKeyErrors = database.pragma("foreign_key_check");
  assert(integrity === "ok" && foreignKeyErrors.length === 0, "数据库完整性检查失败。");

  const result = {
    success: true,
    batchId,
    scope: SALES_LINK_SKU_IDS,
    outcomes,
    appliedCount: outcomes.filter((item) => item.outcome === "applied").length,
    idempotentCount: outcomes.filter((item) => item.outcome === "idempotent").length,
    generatedMappingCount: outcomes.reduce((sum, item) => sum + Number(item.generatedMappingCount || 0), 0),
    activeMappingBefore: mappingBefore,
    activeMappingAfter: database.prepare("SELECT COUNT(*) total FROM sales_link_sku_erp_mappings WHERE currentState='active'").get().total,
    activeStructureBefore,
    activeStructureAfter: database.prepare("SELECT COUNT(*) total FROM sales_link_sku_product_structures WHERE status='active'").get().total,
    resolverPassed: SALES_LINK_SKU_IDS.length,
    protectedBefore,
    protectedAfter,
    integrityCheck: integrity,
    foreignKeyCheckErrors: foreignKeyErrors.length,
  };
  fs.writeFileSync(path.resolve(outputPath), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  closeDatabase();
}
