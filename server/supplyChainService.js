import crypto from "node:crypto";
import { getDatabase } from "./db.js";

const supplierStatuses = new Set(["active", "paused", "archived"]);
const relationStatuses = new Set(["active", "inactive"]);
const orderTypes = new Set(["demand", "plan", "purchase"]);
const orderStatuses = new Set(["draft", "planned", "ordered", "partial", "received", "canceled"]);
const qualityStatuses = new Set(["open", "improving", "resolved", "closed"]);
const severities = new Set(["low", "medium", "high", "critical"]);

function text(value) { return String(value ?? "").trim(); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function placeholders(values) { return values.map(() => "?").join(","); }

function latestInventoryByProduct(database) {
  const latest = database.prepare("SELECT id,businessDate FROM erp_fact_snapshots WHERE status='completed' ORDER BY businessDate DESC,createdAt DESC LIMIT 1").get();
  if (!latest) return { businessDate: null, byProduct: new Map() };
  const rows = database.prepare(`SELECT productId,SUM(actualStock) actualStock,SUM(purchaseInTransit) purchaseInTransit,
    SUM(CASE WHEN unitCost IS NOT NULL AND actualStock IS NOT NULL THEN unitCost*actualStock ELSE 0 END) capitalOccupation,
    SUM(CASE WHEN unitCost IS NOT NULL THEN 1 ELSE 0 END) costCount,COUNT(*) specificationCount
    FROM product_erp_daily_snapshots WHERE snapshotId=? GROUP BY productId`).all(latest.id);
  const sales = new Map(database.prepare("SELECT productId,sales30d FROM product_daily_snapshots WHERE snapshotId=?").all(latest.id).map((row) => [row.productId, number(row.sales30d)]));
  return { businessDate: latest.businessDate, byProduct: new Map(rows.map((row) => [row.productId, { actualStock: number(row.actualStock),
    purchaseInTransit: number(row.purchaseInTransit), capitalOccupation: Number(row.capitalOccupation || 0),
    costCoverage: row.specificationCount ? Number(row.costCount || 0) / Number(row.specificationCount) : 0, sales30d: sales.get(row.productId) ?? null }])) };
}

function supplierSelect() {
  return `SELECT s.*,
    (SELECT COUNT(DISTINCT productId) FROM supplier_products sp WHERE sp.supplierId=s.id AND sp.status='active') productCount,
    (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplierId=s.id AND po.status NOT IN ('received','canceled')) openPurchaseCount,
    (SELECT COUNT(*) FROM supplier_quality_issues q WHERE q.supplierId=s.id AND q.status NOT IN ('resolved','closed')) openQualityCount,
    (SELECT totalScore FROM supplier_evaluations e WHERE e.supplierId=s.id ORDER BY periodEnd DESC,createdAt DESC LIMIT 1) latestScore,
    (SELECT periodEnd FROM supplier_evaluations e WHERE e.supplierId=s.id ORDER BY periodEnd DESC,createdAt DESC LIMIT 1) latestEvaluationDate`;
}

export function listSuppliers(filters = {}) {
  const clauses = ["1=1"]; const values = [];
  if (text(filters.status)) { clauses.push("s.status=?"); values.push(text(filters.status)); }
  if (text(filters.search)) { clauses.push("(LOWER(s.name) LIKE ? OR LOWER(s.code) LIKE ?)"); const query = `%${text(filters.search).toLowerCase()}%`; values.push(query, query); }
  return getDatabase().prepare(`${supplierSelect()} FROM suppliers s WHERE ${clauses.join(" AND ")} ORDER BY s.updatedAt DESC,s.name`).all(...values);
}

export function readSupplier(idValue) {
  const database = getDatabase(); const supplier = database.prepare(`${supplierSelect()} FROM suppliers s WHERE s.id=?`).get(text(idValue));
  if (!supplier) throw new Error("供应商不存在。");
  const relations = database.prepare(`SELECT sp.*,p.name productName,p.skuCode,m.merchantSkuCode,m.specificationName
    FROM supplier_products sp JOIN products p ON p.id=sp.productId LEFT JOIN product_erp_mappings m ON m.id=sp.productErpMappingId
    WHERE sp.supplierId=? ORDER BY sp.isPrimary DESC,p.skuCode,sp.createdAt`).all(supplier.id);
  const inventory = latestInventoryByProduct(database);
  const products = relations.map((row) => { const fact = inventory.byProduct.get(row.productId) ?? {}; const safetyStock = number(row.safetyStock);
    const actualStock = fact.actualStock ?? null; const turnover = actualStock !== null && fact.sales30d !== null && actualStock + fact.sales30d > 0 ? fact.sales30d / (actualStock + fact.sales30d) : null;
    const risk = actualStock === null ? "no_data" : safetyStock !== null && actualStock < safetyStock ? "shortage" : actualStock > 0 && (fact.sales30d ?? 0) === 0 ? "backlog" : "healthy";
    return { ...row, inventory: { ...fact, safetyStock, turnover, risk, businessDate: inventory.businessDate } }; });
  const orders = database.prepare(`SELECT po.*,COALESCE(SUM(i.quantity),0) totalQuantity,COALESCE(SUM(i.receivedQuantity),0) receivedQuantity,
    COALESCE(SUM(i.quantity*i.unitCost),0) totalAmount FROM purchase_orders po LEFT JOIN purchase_order_items i ON i.purchaseOrderId=po.id
    WHERE po.supplierId=? GROUP BY po.id ORDER BY po.createdAt DESC`).all(supplier.id);
  const qualityIssues = database.prepare(`SELECT q.*,p.name productName,pe.name ownerName FROM supplier_quality_issues q
    LEFT JOIN products p ON p.id=q.productId LEFT JOIN persons pe ON pe.id=q.ownerId WHERE q.supplierId=? ORDER BY q.createdAt DESC`).all(supplier.id);
  const evaluations = database.prepare("SELECT e.*,p.name evaluatorName FROM supplier_evaluations e LEFT JOIN persons p ON p.id=e.evaluatedBy WHERE e.supplierId=? ORDER BY e.periodEnd DESC,e.createdAt DESC").all(supplier.id);
  return { supplier, products, orders, qualityIssues, evaluations };
}

export function getSupplyChainOverview() {
  const database = getDatabase(); const suppliers = listSuppliers(); const inventory = latestInventoryByProduct(database);
  const activeRelations = database.prepare("SELECT supplierId,productId,safetyStock FROM supplier_products WHERE status='active'").all();
  const risks = activeRelations.map((row) => { const fact = inventory.byProduct.get(row.productId); const safetyStock = number(row.safetyStock); if (!fact) return null;
    const type = safetyStock !== null && (fact.actualStock ?? 0) < safetyStock ? "shortage" : (fact.actualStock ?? 0) > 0 && (fact.sales30d ?? 0) === 0 ? "backlog" : "";
    return type ? { ...row, type, actualStock: fact.actualStock, safetyStock, sales30d: fact.sales30d } : null; }).filter(Boolean);
  const overdue = database.prepare(`SELECT COUNT(*) count FROM purchase_orders WHERE status IN ('planned','ordered','partial') AND expectedAt IS NOT NULL AND expectedAt<date('now')`).get();
  return { summary: { supplierCount: suppliers.length, activeSupplierCount: suppliers.filter((item) => item.status === "active").length,
    shortageCount: risks.filter((item) => item.type === "shortage").length, backlogCount: risks.filter((item) => item.type === "backlog").length,
    openQualityCount: suppliers.reduce((sum, item) => sum + Number(item.openQualityCount || 0), 0), overduePurchaseCount: Number(overdue.count || 0), businessDate: inventory.businessDate },
    supplierPerformance: [...suppliers].filter((item) => item.latestScore !== null).sort((a, b) => Number(b.latestScore) - Number(a.latestScore)).slice(0, 10), risks };
}

export function saveSupplier(input, userId, supplierId = "") {
  const database = getDatabase(); const status = text(input?.status) || "active"; if (!supplierStatuses.has(status)) throw new Error("供应商状态无效。");
  const code = text(input?.code); const name = text(input?.name); if (!code || !name) throw new Error("供应商编码和名称不能为空。"); const timestamp = now(); const supplierKey = text(supplierId) || id("supplier");
  database.prepare(`INSERT INTO suppliers (id,code,name,contactName,contactPhone,contactEmail,address,status,notes,createdBy,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code,name=excluded.name,contactName=excluded.contactName,
    contactPhone=excluded.contactPhone,contactEmail=excluded.contactEmail,address=excluded.address,status=excluded.status,notes=excluded.notes,updatedAt=excluded.updatedAt`)
    .run(supplierKey,code,name,text(input.contactName),text(input.contactPhone),text(input.contactEmail),text(input.address),status,text(input.notes),userId||null,timestamp,timestamp);
  return readSupplier(supplierKey).supplier;
}

export function addSupplierProduct(supplierId, input) {
  const database = getDatabase(); const productId = text(input?.productId); if (!database.prepare("SELECT 1 FROM suppliers WHERE id=?").get(text(supplierId))) throw new Error("供应商不存在。");
  if (!database.prepare("SELECT 1 FROM products WHERE id=?").get(productId)) throw new Error("产品不存在。"); const mappingId = text(input?.productErpMappingId) || null;
  if (mappingId && !database.prepare("SELECT 1 FROM product_erp_mappings WHERE id=? AND productId=?").get(mappingId,productId)) throw new Error("ERP规格与产品不匹配。");
  const status = text(input?.status)||"active"; if (!relationStatuses.has(status)) throw new Error("供应关系状态无效。"); const timestamp=now(); const relationId=id("supplier-product");
  database.prepare(`INSERT INTO supplier_products (id,supplierId,productId,productErpMappingId,supplierSkuCode,unitCost,safetyStock,leadTimeDays,isPrimary,status,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(relationId,text(supplierId),productId,mappingId,text(input.supplierSkuCode),number(input.unitCost),number(input.safetyStock),number(input.leadTimeDays),input.isPrimary?1:0,status,timestamp,timestamp);
  return readSupplier(supplierId).products.find((item)=>item.id===relationId);
}

export function removeSupplierProduct(supplierId, relationId) {
  const result=getDatabase().prepare("DELETE FROM supplier_products WHERE id=? AND supplierId=?").run(text(relationId),text(supplierId)); if(!result.changes) throw new Error("供应产品关系不存在。"); return {success:true};
}

export function createPurchaseOrder(input, userId) {
  const database=getDatabase(); const supplierId=text(input?.supplierId); if(!database.prepare("SELECT 1 FROM suppliers WHERE id=? AND status='active'").get(supplierId)) throw new Error("请选择有效供应商。");
  const orderType=text(input?.orderType)||"purchase"; if(!orderTypes.has(orderType)) throw new Error("采购类型无效。"); const items=Array.isArray(input?.items)?input.items:[]; if(!items.length) throw new Error("采购至少需要一个产品明细。");
  return database.transaction(()=>{const timestamp=now();const orderId=id("purchase");const businessCode=`PO-${timestamp.slice(0,10).replaceAll("-","")}-${crypto.randomUUID().slice(0,6).toUpperCase()}`;
    database.prepare(`INSERT INTO purchase_orders (id,businessCode,supplierId,orderType,status,expectedAt,notes,createdBy,createdAt,updatedAt) VALUES (?,?,?,?, 'draft',?,?,?,?,?)`)
      .run(orderId,businessCode,supplierId,orderType,text(input.expectedAt)||null,text(input.notes),userId||null,timestamp,timestamp);
    const insert=database.prepare(`INSERT INTO purchase_order_items (id,purchaseOrderId,productId,productErpMappingId,quantity,receivedQuantity,unitCost,createdAt,updatedAt) VALUES (?,?,?,?,?,0,?,?,?)`);
    for(const item of items){const quantity=number(item.quantity);if(!quantity||quantity<=0)throw new Error("采购数量必须大于0。");if(!database.prepare("SELECT 1 FROM products WHERE id=?").get(text(item.productId)))throw new Error("采购产品不存在。");insert.run(id("purchase-item"),orderId,text(item.productId),text(item.productErpMappingId)||null,quantity,number(item.unitCost),timestamp,timestamp);} return readSupplier(supplierId).orders.find((item)=>item.id===orderId);})();
}

export function updatePurchaseOrder(idValue,input){const status=text(input?.status);if(!orderStatuses.has(status))throw new Error("采购状态无效。");const database=getDatabase();const timestamp=now();const current=database.prepare("SELECT * FROM purchase_orders WHERE id=?").get(text(idValue));if(!current)throw new Error("采购记录不存在。");
  return database.transaction(()=>{database.prepare("UPDATE purchase_orders SET status=?,expectedAt=?,orderedAt=?,receivedAt=?,notes=?,updatedAt=? WHERE id=?").run(status,text(input.expectedAt)||current.expectedAt,status==="ordered"?(current.orderedAt||timestamp):current.orderedAt,status==="received"?(current.receivedAt||timestamp):current.receivedAt,text(input.notes??current.notes),timestamp,current.id);
    if(status==="received")database.prepare("UPDATE purchase_order_items SET receivedQuantity=quantity,updatedAt=? WHERE purchaseOrderId=?").run(timestamp,current.id);
    return database.prepare("SELECT * FROM purchase_orders WHERE id=?").get(current.id);})();}

export function createQualityIssue(input){const database=getDatabase();const supplierId=text(input?.supplierId);if(!database.prepare("SELECT 1 FROM suppliers WHERE id=?").get(supplierId))throw new Error("供应商不存在。");const severity=text(input?.severity)||"medium";if(!severities.has(severity))throw new Error("品质严重程度无效。");if(!text(input?.title))throw new Error("品质问题标题不能为空。");const timestamp=now();const issueId=id("supplier-quality");database.prepare(`INSERT INTO supplier_quality_issues (id,supplierId,productId,purchaseOrderId,title,severity,status,description,resultSummary,ownerId,createdAt,updatedAt) VALUES (?,?,?,?,?,?,'open',?,?,?, ?,?)`).run(issueId,supplierId,text(input.productId)||null,text(input.purchaseOrderId)||null,text(input.title),severity,text(input.description),text(input.resultSummary),text(input.ownerId)||null,timestamp,timestamp);return readSupplier(supplierId).qualityIssues.find((item)=>item.id===issueId);}

export function updateQualityIssue(idValue,input){const database=getDatabase();const current=database.prepare("SELECT * FROM supplier_quality_issues WHERE id=?").get(text(idValue));if(!current)throw new Error("品质问题不存在。");const status=text(input?.status)||current.status;if(!qualityStatuses.has(status))throw new Error("品质问题状态无效。");database.prepare("UPDATE supplier_quality_issues SET status=?,resultSummary=?,ownerId=?,updatedAt=? WHERE id=?").run(status,text(input.resultSummary??current.resultSummary),text(input.ownerId)||current.ownerId,now(),current.id);return database.prepare("SELECT * FROM supplier_quality_issues WHERE id=?").get(current.id);}

export function saveSupplierEvaluation(input,userId){const database=getDatabase();const supplierId=text(input?.supplierId);if(!database.prepare("SELECT 1 FROM suppliers WHERE id=?").get(supplierId))throw new Error("供应商不存在。");const scores=["costScore","deliveryScore","qualityScore","cooperationScore"].map((key)=>number(input[key]));if(scores.some((score)=>score===null||score<0||score>100))throw new Error("评价分数必须在0到100之间。");if(!text(input.periodStart)||!text(input.periodEnd)||text(input.periodStart)>text(input.periodEnd))throw new Error("评价周期无效。");const totalScore=Math.round(scores.reduce((sum,value)=>sum+value,0)/scores.length*10)/10;const timestamp=now();const evaluationId=id("supplier-evaluation");database.prepare(`INSERT INTO supplier_evaluations (id,supplierId,periodStart,periodEnd,costScore,deliveryScore,qualityScore,cooperationScore,totalScore,notes,evaluatedBy,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(evaluationId,supplierId,text(input.periodStart),text(input.periodEnd),...scores,totalScore,text(input.notes),userId||null,timestamp,timestamp);return readSupplier(supplierId).evaluations.find((item)=>item.id===evaluationId);}
