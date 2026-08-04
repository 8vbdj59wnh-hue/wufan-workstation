import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wufan-sync-reliability-"));
process.env.WUFAN_DB_PATH = path.join(root, "workstation.db");
const dbModule = await import("../server/db.js");
const syncModule = await import("../server/dataSyncCenterService.js");
const { runWangdianPagedWindows, clearDataSyncCheckpoint } = await import("../server/dataSyncPagedExecution.js");
const { createWangdianRequestScheduler } = await import("../server/wangdianRequestScheduler.js");

dbModule.initializeDatabase({ reset: true });
const db = dbModule.getDatabase();
syncModule.setDataSyncTaskStatus("sync-task-erp-goods", "enabled");
const businessCounts = () => ({ goods: db.prepare("SELECT COUNT(*) total FROM erp_goods").get().total, skus: db.prepare("SELECT COUNT(*) total FROM erp_skus").get().total, products: db.prepare("SELECT COUNT(*) total FROM products").get().total });
const before = businessCounts();
const windows = Array.from({ length: 69 }, (_, index) => ({ start_time: `window-${index}`, end_time: `window-${index}` }));

let fakeNow = 0;
const waits = [];
const events = [];
const scheduler = createWangdianRequestScheduler({
  requestsPerMinute: 55,
  maxRetries: 3,
  baseDelayMs: 2000,
  now: () => fakeNow,
  sleep: async (milliseconds) => { waits.push(milliseconds); fakeNow += milliseconds; },
});
const batch = syncModule.createDataSyncBatch("sync-task-erp-goods", { syncMode: "full", requestStart: "2021-01-01", requestEnd: "2026-08-05" });
syncModule.startDataSyncBatch(batch.id);
let physicalCalls = 0;
let limited = false;
const first = await runWangdianPagedWindows({
  batchId: batch.id,
  windows,
  pageSize: 2,
  extractItems: (payload) => payload.data.goods_list,
  queryPage: async ({ params, onScheduleEvent }) => scheduler.execute(async () => {
    physicalCalls += 1;
    if (!limited && physicalCalls === 61) { limited = true; throw new Error("旺店通接口失败（100）：超过每分钟最大调用频率限制"); }
    return { status: 0, data: { total_count: 1, goods_list: [{ id: params.start_time }] } };
  }, { onEvent: (event) => { events.push(event); onScheduleEvent?.(event); } }),
});
assert.equal(first.rows.length, 69);
assert.equal(new Set(first.rows.map((item) => item.id)).size, 69);
assert.equal(physicalCalls, 70, "第61次限流后应只重试一次");
assert.ok(events.some((event) => event.type === "rate_limit_retry"));
assert.ok(waits.some((milliseconds) => milliseconds >= 2000));
assert.deepEqual(businessCounts(), before, "预览读取不得写入业务事实");
clearDataSyncCheckpoint(batch.id);

const resumeBatch = syncModule.createDataSyncBatch("sync-task-erp-goods", { syncMode: "full", requestStart: "2021-01-01", requestEnd: "2026-08-05" });
syncModule.startDataSyncBatch(resumeBatch.id);
let interrupted = false;
try {
  await runWangdianPagedWindows({
    batchId: resumeBatch.id,
    windows,
    pageSize: 2,
    extractItems: (payload) => payload.data.goods_list,
    queryPage: async ({ params }) => {
      const index = Number(params.start_time.split("-")[1]);
      if (index === 20) throw new Error("模拟进程中断");
      return { data: { total_count: 1, goods_list: [{ id: params.start_time }] } };
    },
  });
} catch (error) {
  interrupted = error.message === "模拟进程中断";
}
assert.equal(interrupted, true);
syncModule.interruptDataSyncBatch(resumeBatch.id, new Error("模拟进程中断"));
assert.equal(syncModule.getDataSyncBatch(resumeBatch.id).status, "interrupted");
const savedProgress = JSON.parse(db.prepare("SELECT progressJson FROM data_sync_batches WHERE id=?").get(resumeBatch.id).progressJson);
assert.equal(savedProgress.windowIndex, 20);
syncModule.resumeDataSyncBatch(resumeBatch.id);
assert.equal(syncModule.getDataSyncBatch(resumeBatch.id).status, "running");
const resumedWindows = [];
const resumed = await runWangdianPagedWindows({
  batchId: resumeBatch.id,
  windows,
  pageSize: 2,
  extractItems: (payload) => payload.data.goods_list,
  queryPage: async ({ params }) => {
    resumedWindows.push(params.start_time);
    return { data: { total_count: 1, goods_list: [{ id: params.start_time }] } };
  },
});
assert.equal(resumedWindows[0], "window-20", "续跑必须从中断窗口开始");
assert.equal(resumed.rows.length, 69);
assert.equal(new Set(resumed.rows.map((item) => item.id)).size, 69, "续跑不得重复累计记录");
assert.deepEqual(businessCounts(), before);
clearDataSyncCheckpoint(resumeBatch.id);

const logs = db.prepare("SELECT eventType,detailJson FROM data_sync_logs WHERE batchId=? ORDER BY createdAt,id").all(batch.id);
assert.ok(logs.some((item) => item.eventType === "rate_limit_retry"));
assert.ok(logs.some((item) => item.eventType === "page_completed"));
assert.ok(logs.some((item) => item.eventType === "paged_read_completed"));

console.log(JSON.stringify({ success: true, windows: windows.length, rows: first.rows.length, physicalCalls, rateLimitRetries: events.filter((event) => event.type === "rate_limit_retry").length, resumedFrom: resumedWindows[0], businessCountsUnchanged: true }));
db.close();
fs.rmSync(root, { recursive: true, force: true });
