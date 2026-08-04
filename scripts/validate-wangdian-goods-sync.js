import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wufan-wangdian-sync-"));
process.env.WUFAN_DB_PATH = path.join(root, "isolated.db");

const databaseModule = await import("../server/db.js");
databaseModule.initializeDatabase();
const database = databaseModule.getDatabase();
const service = await import("../server/productV2Import.js");
const client = await import("../server/wangdianClient.js");

let transportRequest = null;
const transportPayload = await client.queryWangdianGoods({
  params: { goods_no: "G-CHECK" },
  pageNo: 0,
  pageSize: 100,
  now: Date.UTC(2026, 7, 4),
  config: { apiUrl: "http://example.invalid/openapi", sid: "test-sid", key: "test-key", secret: "test-secret", salt: "test-salt" },
  fetchImpl: async (url, options) => {
    transportRequest = { url: String(url), options };
    return new Response(JSON.stringify({ status: 0, data: { goods_list: [], total_count: 0 } }), { status: 200, headers: { "Content-Type": "application/json" } });
  },
});
assert.equal(transportPayload.status, 0);
assert.match(transportRequest.url, /method=goods.Goods.queryWithSpec/u);
assert.match(transportRequest.url, /sign=[0-9a-f]{32}/u);
assert.deepEqual(JSON.parse(transportRequest.options.body), [{ goods_no: "G-CHECK" }]);

function goods(index, suffix = "A", overrides = {}) {
  return {
    goods_id: index,
    goods_no: `G-${suffix}-${index}`,
    goods_name: `旺店通货品 ${suffix}-${index}`,
    short_name: `货品${index}`,
    brand_name: "测试品牌",
    class_name: "测试分类",
    goods_type: 1,
    goods_created: "2026-01-01 00:00:00",
    modified: "2026-08-01 10:00:00",
    deleted: 0,
    spec_list: [{
      spec_id: index,
      spec_no: `SKU-${suffix}-${index}`,
      spec_name: `规格 ${index}`,
      barcode: `BAR-${suffix}-${index}`,
      spec_modified: "2026-08-01 10:01:00",
      deleted: 0,
      img_url: "cos://official-relative-image.jpg",
    }],
    ...overrides,
  };
}

const productsBefore = database.prepare("SELECT COUNT(*) count FROM products").get().count;
const fullRun = service.createErpSyncRun({ businessDate: "2026-08-01", syncType: "master_data", dataSource: "wangdian_api", createdBy: "person-admin" });
const pageCalls = [];
const fullPreview = await service.parseWangdianGoodsImport({
  syncRunId: fullRun.id,
  importMode: "full",
  query: { startTime: "2026-06-25 00:00:00", endTime: "2026-08-01 00:00:00" },
  createdBy: "person-admin",
  queryGoods: async ({ params, pageNo }) => {
    pageCalls.push({ params, pageNo });
    const suffix = params.start_time.slice(5, 10).replace("-", "");
    const list = pageNo === 0
      ? Array.from({ length: 100 }, (_, index) => goods(index + 1, suffix))
      : pageNo === 1 ? [goods(101, suffix)] : [];
    return { status: 0, data: { goods_list: list, total_count: 101 } };
  },
});
assert.equal(fullPreview.valid, true);
assert.ok(pageCalls.some((item) => item.pageNo === 1), "应读取第二页");
assert.ok(new Set(pageCalls.map((item) => item.params.start_time)).size >= 2, "全量范围应拆成多个不超过30天的窗口");
service.validateErpV2Import(fullPreview.batch.id);
const fullPreviewV2 = await service.parseWangdianGoodsImport({
  syncRunId: fullRun.id,
  importMode: "full",
  query: { startTime: "2026-06-25 00:00:00", endTime: "2026-08-01 01:00:00" },
  createdBy: "person-admin",
  queryGoods: async ({ params, pageNo }) => {
    const suffix = params.start_time.slice(5, 10).replace("-", "");
    const list = pageNo === 0
      ? Array.from({ length: 100 }, (_, index) => goods(index + 1, suffix))
      : pageNo === 1 ? [goods(101, suffix)] : [];
    return { status: 0, data: { goods_list: list, total_count: 101 } };
  },
});
assert.equal(fullPreviewV2.batch.summaryJson.previewVersion, 2);
const fullValidatedV2 = service.validateErpV2Import(fullPreviewV2.batch.id);
assert.equal(fullValidatedV2.summary.previewVersion, 2);
assert.equal(database.prepare("SELECT COUNT(*) count FROM erp_import_batches WHERE syncRunId=? AND importType='goods_info'").get(fullRun.id).count, 2);
assert.equal(service.readErpSyncRun(fullRun.id).goodsInfoBatchId, fullPreviewV2.batch.id);
const fullPreviewLogs = service.listWangdianGoodsSyncLogs(10).filter((item) => item.syncRunId === fullRun.id);
assert.equal(fullPreviewLogs.length, 2);
assert.notEqual(fullPreviewLogs[0].requestEnd, fullPreviewLogs[1].requestEnd);
assert.throws(() => service.commitErpV2Import(fullPreview.batch.id), /当前有效预览/u);
const fullCommit = service.commitErpV2Import(fullPreviewV2.batch.id);
assert.equal(fullCommit.idempotent, false);
const goodsAfterFull = database.prepare("SELECT COUNT(*) count FROM erp_goods").get().count;
const skusAfterFull = database.prepare("SELECT COUNT(*) count FROM erp_skus").get().count;
assert.equal(goodsAfterFull, 202);
assert.equal(skusAfterFull, 202);
assert.equal(database.prepare("SELECT COUNT(*) count FROM products").get().count, productsBefore, "不得自动创建products");

const repeated = service.commitErpV2Import(fullPreviewV2.batch.id);
assert.equal(repeated.idempotent, true);
assert.equal(database.prepare("SELECT COUNT(*) count FROM erp_goods").get().count, goodsAfterFull);
assert.equal(database.prepare("SELECT COUNT(*) count FROM erp_skus").get().count, skusAfterFull);

const incrementalRun = service.createErpSyncRun({ businessDate: "2026-08-02", syncType: "master_data", dataSource: "wangdian_api", createdBy: "person-admin" });
const incrementalPreview = await service.parseWangdianGoodsImport({
  syncRunId: incrementalRun.id,
  importMode: "incremental",
  query: { startTime: "2026-08-01 00:00:00", endTime: "2026-08-02 00:00:00", safetyLookbackMinutes: 10 },
  createdBy: "person-admin",
  queryGoods: async ({ params }) => ({
    status: 0,
    data: {
      total_count: 1,
      goods_list: [goods(1, "0625", {
        goods_name: "旺店通货品（增量更新）",
        modified: "2026-08-02 09:00:00",
        spec_list: [{ spec_id: 1, spec_no: "SKU-0625-1", spec_name: "停用规格", spec_modified: "2026-08-02 09:00:00", deleted: 1 }],
      })],
    },
  }),
});
assert.equal(incrementalPreview.syncLog.requestJson.query.start_time, "2026-07-31 23:50:00", "增量同步应安全回看");
service.validateErpV2Import(incrementalPreview.batch.id);
service.commitErpV2Import(incrementalPreview.batch.id);
assert.equal(database.prepare("SELECT goodsName FROM erp_goods WHERE goodsCode='G-0625-1'").get().goodsName, "旺店通货品（增量更新）");
const changedSku = database.prepare("SELECT currentState,erpStatus,sourceUpdatedAt,rawSourceData FROM erp_skus WHERE merchantSkuCode='SKU-0625-1'").get();
assert.equal(changedSku.currentState, "deleted");
assert.equal(changedSku.erpStatus, "inactive");
assert.equal(changedSku.sourceUpdatedAt, "2026-08-02 09:00:00");
assert.equal(JSON.parse(changedSku.rawSourceData).deleted, 1);

const invalidRun = service.createErpSyncRun({ businessDate: "2026-08-03", syncType: "master_data", dataSource: "wangdian_api", createdBy: "person-admin" });
const invalidPreview = await service.parseWangdianGoodsImport({
  syncRunId: invalidRun.id,
  importMode: "incremental",
  query: { startTime: "2026-08-02 00:00:00", endTime: "2026-08-03 00:00:00" },
  createdBy: "person-admin",
  queryGoods: async () => ({ status: 0, data: { total_count: 1, goods_list: [{ goods_no: "BROKEN", goods_name: "缺失SKU", spec_list: [] }] } }),
});
assert.equal(invalidPreview.valid, false);
assert.ok(invalidPreview.summary.error > 0);

const failedRun = service.createErpSyncRun({ businessDate: "2026-08-04", syncType: "master_data", dataSource: "wangdian_api", createdBy: "person-admin" });
await assert.rejects(() => service.parseWangdianGoodsImport({
  syncRunId: failedRun.id,
  importMode: "incremental",
  query: { startTime: "2026-08-03 00:00:00", endTime: "2026-08-04 00:00:00" },
  createdBy: "person-admin",
  queryGoods: async () => { throw new Error("模拟API错误"); },
}), /模拟API错误/u);
assert.equal(service.listWangdianGoodsSyncLogs(1)[0].status, "failed");

assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
assert.deepEqual(database.pragma("foreign_key_check"), []);

console.log(JSON.stringify({
  full: { goods: goodsAfterFull, skus: skusAfterFull, pages: pageCalls.length, windows: new Set(pageCalls.map((item) => item.params.start_time)).size },
  incremental: { updated: true, safetyLookback: true, deletedSkuPreserved: true },
  idempotent: repeated.idempotent,
  invalidBlocked: !invalidPreview.valid,
  apiFailureLogged: true,
  apiTransport: "signed request ok",
  productsUnchanged: productsBefore,
  integrityCheck: "ok",
  foreignKeyCheck: 0,
}, null, 2));

databaseModule.closeDatabase();
fs.rmSync(root, { recursive: true, force: true });
