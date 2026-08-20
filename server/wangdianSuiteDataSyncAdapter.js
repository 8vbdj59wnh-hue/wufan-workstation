import crypto from "node:crypto";
import { getDatabase } from "./db.js";
import {
  advanceDataSyncTaskSchedule,
  completeDataSyncBatch,
  createDataSyncBatch,
  getDataSyncTask,
  getLatestDataSyncWatermark,
  listDueDataSyncTasks,
  startDataSyncBatch,
} from "./dataSyncCenterService.js";
import { searchWangdianSuites } from "./wangdianSuiteService.js";

const TASK_CODE = "wangdian_suites";
const SOURCE_TYPE = "wangdian_suite_api";
const MAX_WINDOW_MS = 30 * 86400000;
const clean = (value) => String(value ?? "").trim().replace(/\.0+$/u, "");
const normalized = (value) => clean(value).toLowerCase();
const stableId = (prefix, value) => `${prefix}-${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24)}`;
const hash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const now = () => new Date().toISOString();

function sourceReference(suite) {
  return JSON.stringify({
    interfaceMethod: "goods.Suite.search",
    wangdianSuiteId: suite.wangdianSuiteId,
    suiteCode: suite.suiteCode,
    suiteName: suite.suiteName,
    shortName: suite.shortName,
    modifiedAt: suite.modifiedAt,
    components: suite.components.map((item) => ({
      wangdianDetailId: item.wangdianDetailId,
      wangdianSpecId: item.wangdianSpecId,
      skuCode: item.skuCode,
      quantity: item.quantity,
    })),
  });
}

function reviewerId(database, requestedId) {
  if (requestedId && database.prepare("SELECT id FROM persons WHERE id=? AND status='active'").get(requestedId)) return requestedId;
  return database.prepare("SELECT id FROM persons WHERE status='active' ORDER BY CASE authRole WHEN 'admin' THEN 0 ELSE 1 END,id LIMIT 1").get()?.id ?? null;
}

function formatWangdianTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("组合装同步时间范围无效。");
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

function splitWindows(requestStart, requestEnd) {
  const start = new Date(requestStart);
  const end = new Date(requestEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) throw new Error("组合装同步时间范围无效。");
  const windows = [];
  for (let cursor = start.getTime(); cursor <= end.getTime();) {
    const windowEnd = Math.min(end.getTime(), cursor + MAX_WINDOW_MS);
    windows.push({ start: new Date(cursor).toISOString(), end: new Date(windowEnd).toISOString() });
    if (windowEnd === end.getTime()) break;
    cursor = windowEnd + 1000;
  }
  return windows;
}

function requestRange(task, input) {
  const requestEnd = input.requestEnd || now();
  if (input.suiteNo) return { requestStart: requestEnd, requestEnd };
  if (input.syncMode === "full") {
    if (!input.requestStart) throw new Error("组合装全量同步必须提供开始时间。");
    return { requestStart: input.requestStart, requestEnd };
  }
  const watermark = input.requestStart || task.lastSuccessAt || getLatestDataSyncWatermark(task.id);
  return { requestStart: watermark || new Date(new Date(requestEnd).getTime() - MAX_WINDOW_MS).toISOString(), requestEnd };
}

export async function readWangdianSuiteChanges(input = {}, options = {}) {
  const querySuites = options.querySuites;
  const suites = new Map();
  let requestCount = 0;
  const readQuery = async (query) => {
    let pageNo = 0;
    while (true) {
      const result = await searchWangdianSuites({ ...query, pageNo, pageSize: 500, hideDeleted: false }, querySuites ? { querySuites } : {});
      requestCount += 1;
      for (const suite of result.items) {
        const code = normalized(suite.suiteCode);
        if (!code) continue;
        const existing = suites.get(code);
        if (!existing || clean(suite.modifiedAt) >= clean(existing.modifiedAt)) suites.set(code, suite);
      }
      const total = Number(result.pagination.total || 0);
      if ((pageNo + 1) * result.pagination.pageSize >= total || result.items.length === 0) break;
      pageNo += 1;
    }
  };
  if (input.suiteNo) await readQuery({ suiteNo: input.suiteNo });
  else for (const window of splitWindows(input.requestStart, input.requestEnd)) {
    await readQuery({ startTime: formatWangdianTime(window.start), endTime: formatWangdianTime(window.end) });
  }
  return { items: [...suites.values()], requestCount };
}

export function applyWangdianSuiteChanges(suites, input = {}, options = {}) {
  const database = options.database || getDatabase();
  const timestamp = input.timestamp || now();
  const reviewedBy = reviewerId(database, input.createdBy);
  if (!reviewedBy) throw new Error("缺少可用于激活组合装结构的系统审核身份。");
  const erpRows = database.prepare("SELECT id,merchantSkuCode FROM erp_skus WHERE currentState='active'").all();
  const erpByCode = new Map(erpRows.map((row) => [normalized(row.merchantSkuCode), row]));
  const result = {
    totalCount: suites.length, createdCount: 0, updatedCount: 0, invalidatedCount: 0,
    unchangedCount: 0, structuresCreated: 0, componentsCreated: 0, relationsCreated: 0, exceptions: [],
  };
  const exception = (suite, exceptionType, message, rawData = {}) => result.exceptions.push({
    exceptionType, severity: "error", message, entityType: "sales_object", entityId: clean(suite.suiteCode) || null,
    rawData: { wangdianSuiteId: suite.wangdianSuiteId, suiteCode: suite.suiteCode, suiteName: suite.suiteName, ...rawData },
  });

  database.transaction(() => {
    for (const suite of suites) {
      const code = normalized(suite.suiteCode);
      if (!code) { exception(suite, "suite_identity_missing", "旺店通组合装缺少商家编码，未写入系统。"); continue; }
      const existing = database.prepare("SELECT * FROM sales_objects WHERE normalizedObjectCode=?").get(code);
      if (suite.deleted) {
        if (!existing) { result.unchangedCount += 1; continue; }
        const activeRelations = Number(database.prepare("SELECT COUNT(*) total FROM sales_link_sku_sales_object_relations WHERE salesObjectId=? AND status='active'").get(existing.id).total);
        if (activeRelations) exception(suite, "suite_deleted_in_use", "旺店通组合装已删除，但仍有关联链接，系统已保留原结构。", { activeRelations });
        else {
          result.invalidatedCount += database.prepare("UPDATE sales_objects SET status='inactive',lastSeenAt=?,updatedAt=? WHERE id=? AND status<>'inactive'").run(timestamp, timestamp, existing.id).changes;
        }
        continue;
      }
      if (existing && existing.objectType !== "bundle") {
        exception(suite, "sales_object_type_conflict", "相同编码当前属于单品Sales Object，未自动覆盖为组合装。", { salesObjectId: existing.id });
        continue;
      }
      const aggregated = new Map();
      let invalidReason = "";
      for (const component of suite.components.filter((item) => !item.deleted)) {
        const childCode = normalized(component.skuCode);
        const quantity = Number(component.quantity);
        if (!childCode || !(quantity > 0)) { invalidReason = "组合装组件缺少有效SKU编码或数量。"; break; }
        aggregated.set(childCode, (aggregated.get(childCode) || 0) + quantity);
      }
      const components = [];
      if (!invalidReason) for (const [childCode, quantity] of aggregated) {
        const erpSku = erpByCode.get(childCode);
        if (!erpSku) { invalidReason = `组件ERP SKU不存在或未启用：${childCode}`; break; }
        components.push({ erpSkuId: erpSku.id, skuCode: childCode, quantity });
      }
      components.sort((left, right) => left.erpSkuId.localeCompare(right.erpSkuId));
      if (!invalidReason && (!components.length || (components.length === 1 && Number(components[0].quantity) === 1))) invalidReason = "旺店通返回内容不符合组合装结构：至少需要多个组件或单组件数量大于1。";
      if (invalidReason) { exception(suite, "suite_structure_incomplete", invalidReason); continue; }

      const signature = JSON.stringify(components.map((item) => [item.erpSkuId, Number(item.quantity)]));
      const structureHash = hash(signature);
      const salesObjectId = existing?.id || stableId("sales-object", `wangdian|${code}`);
      const referenceJson = sourceReference(suite);
      if (!existing) {
        database.prepare(`INSERT INTO sales_objects
          (id,objectCode,normalizedObjectCode,objectType,source,sourceType,sourceCode,sourceBatchId,status,firstSeenAt,lastSeenAt,createdAt,updatedAt)
          VALUES (?,?,?,'bundle','wangdian',?,?,?,'active',?,?,?,?)`)
          .run(salesObjectId, clean(suite.suiteCode), code, SOURCE_TYPE, clean(suite.wangdianSuiteId) || code, input.sourceBatchId || null, timestamp, timestamp, timestamp, timestamp);
        result.createdCount += 1;
      } else {
        database.prepare(`UPDATE sales_objects SET objectCode=?,source='wangdian',sourceType=?,sourceCode=?,sourceBatchId=?,status='active',lastSeenAt=?,updatedAt=? WHERE id=?`)
          .run(clean(suite.suiteCode), SOURCE_TYPE, clean(suite.wangdianSuiteId) || code, input.sourceBatchId || null, timestamp, timestamp, salesObjectId);
      }
      const activeStructure = database.prepare("SELECT * FROM sales_object_structures WHERE salesObjectId=? AND status='active'").get(salesObjectId);
      if (activeStructure?.structureHash === structureHash) {
        database.prepare("UPDATE sales_object_structures SET sourceType=?,sourceBatchId=?,sourceReferenceJson=?,updatedAt=? WHERE id=?")
          .run(SOURCE_TYPE, input.sourceBatchId || null, referenceJson, timestamp, activeStructure.id);
        result.unchangedCount += 1;
      } else {
        const version = Number(database.prepare("SELECT COALESCE(MAX(version),0)+1 version FROM sales_object_structures WHERE salesObjectId=?").get(salesObjectId).version);
        const structureId = stableId("sales-object-structure", `${salesObjectId}|${structureHash}`);
        database.prepare(`INSERT INTO sales_object_structures
          (id,salesObjectId,version,structureHash,effectiveFrom,status,sourceType,sourceBatchId,sourceReferenceJson,supersedesStructureId,reviewedBy,reviewedAt,activatedAt,createdAt,updatedAt)
          VALUES (?,?,?,?,?,'draft',?,?,?,?,?,?,?, ?,?)`)
          .run(structureId, salesObjectId, version, structureHash, timestamp, SOURCE_TYPE, input.sourceBatchId || null, referenceJson, activeStructure?.id || null, reviewedBy, timestamp, timestamp, timestamp, timestamp);
        const insertComponent = database.prepare(`INSERT INTO sales_object_structure_components
          (id,structureId,salesObjectId,erpSkuId,quantity,sortOrder,status,sourceType,sourceReferenceJson,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?,'active',?,?,?,?)`);
        components.forEach((component, index) => {
          insertComponent.run(stableId("sales-object-component", `${structureId}|${component.erpSkuId}`), structureId, salesObjectId, component.erpSkuId, component.quantity, index + 1, SOURCE_TYPE, JSON.stringify({ skuCode: component.skuCode }), timestamp, timestamp);
          result.componentsCreated += 1;
        });
        if (activeStructure) database.prepare("UPDATE sales_object_structures SET status='superseded',effectiveTo=?,updatedAt=? WHERE id=?").run(timestamp, timestamp, activeStructure.id);
        database.prepare("UPDATE sales_object_structures SET status='active',updatedAt=? WHERE id=?").run(timestamp, structureId);
        result.structuresCreated += 1;
        if (existing) result.updatedCount += 1;
      }

      const linkSkus = database.prepare(`SELECT id FROM sales_link_skus
        WHERE currentState='active' AND lower(trim(COALESCE(NULLIF(normalizedPlatformSkuCode,''),platformSkuCode)))=?`).all(code);
      for (const linkSku of linkSkus) {
        const relation = database.prepare("SELECT * FROM sales_link_sku_sales_object_relations WHERE linkSkuId=? AND status='active'").get(linkSku.id);
        if (relation?.salesObjectId === salesObjectId) continue;
        if (relation) {
          exception(suite, "link_sku_sales_object_conflict", "链接SKU已有其他Sales Object关系，未自动替换。", { linkSkuId: linkSku.id, currentSalesObjectId: relation.salesObjectId, targetSalesObjectId: salesObjectId });
          continue;
        }
        database.prepare(`INSERT INTO sales_link_sku_sales_object_relations
          (id,linkSkuId,salesObjectId,effectiveFrom,status,sourceType,sourceBatchId,sourceReferenceJson,reviewedBy,reviewedAt,createdAt,updatedAt)
          VALUES (?,?,?,?,'active',?,?,?, ?,?,?,?)`)
          .run(stableId("sales-link-sku-sales-object", linkSku.id), linkSku.id, salesObjectId, timestamp, SOURCE_TYPE, input.sourceBatchId || null, JSON.stringify({ suiteCode: clean(suite.suiteCode), interfaceMethod: "goods.Suite.search" }), reviewedBy, timestamp, timestamp, timestamp);
        result.relationsCreated += 1;
      }
    }
  }).immediate();
  return result;
}

export async function syncWangdianSuites(input = {}, options = {}) {
  const task = getDataSyncTask(input.taskId);
  if (!task || task.taskCode !== TASK_CODE) throw new Error("旺店通组合装同步任务不存在。");
  const syncMode = input.syncMode || task.defaultSyncMode;
  const range = requestRange(task, { ...input, syncMode });
  const batch = createDataSyncBatch(task.id, {
    triggerMode: input.triggerMode || "manual", syncMode, ...range,
    scope: input.suiteNo ? { suiteNo: clean(input.suiteNo) } : {}, createdBy: input.createdBy,
  });
  startDataSyncBatch(batch.id);
  try {
    const source = await readWangdianSuiteChanges({ ...range, suiteNo: clean(input.suiteNo) }, options);
    const applied = applyWangdianSuiteChanges(source.items, { sourceBatchId: batch.id, createdBy: input.createdBy }, options);
    const status = applied.exceptions.length ? "partial" : "succeeded";
    const dataSyncBatch = completeDataSyncBatch(batch.id, { ...applied, status, exceptionCount: applied.exceptions.length });
    return { dataSyncBatch, source: { requestCount: source.requestCount }, result: applied };
  } catch (error) {
    completeDataSyncBatch(batch.id, { status: "failed", errorMessage: error.message, exceptions: [{ exceptionType: "wangdian_suite_sync_failed", message: error.message }] });
    error.dataSyncBatchId = batch.id;
    throw error;
  }
}

export async function runDueWangdianSuiteSyncTasks({ createdBy = "system-scheduler", querySuites } = {}) {
  const results = [];
  for (const task of listDueDataSyncTasks().filter((item) => item.taskCode === TASK_CODE)) {
    try {
      results.push({ taskId: task.id, success: true, result: await syncWangdianSuites({ taskId: task.id, syncMode: "incremental", triggerMode: "automatic", createdBy }, querySuites ? { querySuites } : {}) });
    } catch (error) {
      results.push({ taskId: task.id, batchId: error.dataSyncBatchId || null, success: false, error: error.message });
    } finally {
      advanceDataSyncTaskSchedule(task.id, new Date());
    }
  }
  return results;
}

export default syncWangdianSuites;
