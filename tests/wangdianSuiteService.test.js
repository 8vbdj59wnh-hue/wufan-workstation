import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { queryWangdianSuites } from "../server/wangdianClient.js";
import { isWangdianRateLimitError } from "../server/wangdianRequestScheduler.js";
import { normalizeWangdianSuiteQuery, searchWangdianSuites } from "../server/wangdianSuiteService.js";

test("组合装客户端使用goods.Suite.search和suite_no", async () => {
  let request;
  const payload = await queryWangdianSuites({
    params: { suite_no: "FZH0103-11", hide_deleted: 1 },
    now: Date.UTC(2026, 7, 20),
    config: { apiUrl: "http://example.invalid/openapi", sid: "sid", key: "key", secret: "secret", salt: "salt" },
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return new Response(JSON.stringify({ status: 0, data: { total_count: 0, suite_list: [] } }), { status: 200 });
    },
  });
  assert.equal(payload.status, 0);
  assert.match(request.url, /method=goods.Suite.search/u);
  assert.deepEqual(JSON.parse(request.options.body), [{ suite_no: "FZH0103-11", hide_deleted: 1 }]);
});

test("组合装编码查询忽略时间，时间范围查询限制30天", () => {
  assert.deepEqual(normalizeWangdianSuiteQuery({ suiteNo: "FZH0103-11", startTime: "2026-01-01 00:00:00", endTime: "2026-08-20 00:00:00" }).params, {
    hide_deleted: 1,
    suite_no: "FZH0103-11",
  });
  assert.throws(() => normalizeWangdianSuiteQuery({ startTime: "2026-01-01 00:00:00", endTime: "2026-02-01 00:00:01" }), /不能超过30天/u);
});

test("组合装响应转换为Sales Object可用的组件和quantity语义", async () => {
  const result = await searchWangdianSuites({ suiteNo: "FZH0103-11" }, {
    querySuites: async () => ({ status: 0, data: { total_count: 1, suite_list: [{
      suite_id: 10311,
      suite_no: "FZH0103-11",
      suite_name: "测试组合装",
      detail_list: [{ rec_id: 1, spec_id: 9, spec_no: "ERP-001", spec_name: "单品", goods_no: "G-001", goods_name: "测试货品", num: "2.0000", deleted: 0 }],
    }] } }),
  });
  assert.equal(result.items[0].suiteCode, "FZH0103-11");
  assert.equal(result.items[0].wangdianSuiteId, "10311");
  assert.equal(result.items[0].components[0].skuCode, "ERP-001");
  assert.equal(result.items[0].components[0].wangdianSpecId, "9");
  assert.equal(result.items[0].components[0].quantity, 2);
});

test("权限不足不会被误判为限流重试", () => {
  assert.equal(isWangdianRateLimitError(new Error("旺店通接口失败（100）：接口权限不足:goods.Suite.search")), false);
  assert.equal(isWangdianRateLimitError(new Error("旺店通接口失败（100）：超过每分钟最大调用频率限制")), true);
});

test("旺店通组合装同步幂等生成Sales Object并以版本保护结构变更", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wangdian-suite-sync-"));
  process.env.WUFAN_DB_PATH = path.join(directory, "workstation.db");
  const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
  const { syncWangdianSuites } = await import("../server/wangdianSuiteDataSyncAdapter.js");
  try {
    initializeDatabase({ reset: true });
    const database = getDatabase();
    const stamp = "2026-08-20T08:00:00.000Z";
    const reviewer = database.prepare("SELECT id FROM persons WHERE status='active' ORDER BY id LIMIT 1").get();
    database.prepare("UPDATE data_sync_tasks SET status='enabled' WHERE taskCode='wangdian_suites'").run();
    database.prepare("INSERT INTO sales_shops(id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt) VALUES('suite-shop','淘宝','组合装测试店','组合装测试店','组合装测试店','active',?,?)").run(stamp, stamp);
    database.prepare("INSERT INTO sales_links(id,shopId,platformGoodsId,title,identityStrength,currentState,originSource,enrichmentStatus,createdAt,updatedAt) VALUES('suite-link','suite-shop','suite-goods','组合装链接','strong','active','test','complete',?,?)").run(stamp, stamp);
    database.prepare("INSERT INTO sales_link_skus(id,salesLinkId,platformSkuId,platformSkuCode,normalizedPlatformSkuCode,specificationName,matchStatus,currentState,createdAt,updatedAt) VALUES('suite-link-sku','suite-link','suite-platform-sku','FZH0103-11','fzh0103-11','组合规格','pending','active',?,?)").run(stamp, stamp);
    database.prepare("INSERT INTO erp_import_batches(id,importType,originalFilename,fileHash,status,createdAt) VALUES('suite-erp-batch','goods_info','erp.xlsx','suite-erp-hash','completed',?)").run(stamp);
    database.prepare("INSERT INTO erp_goods(id,goodsCode,goodsName,rawSourceData,currentState,createdAt,updatedAt) VALUES('suite-goods-a','G-A','花瓶','{}','active',?,?),('suite-goods-b','G-B','郁金香','{}','active',?,?)").run(stamp, stamp, stamp, stamp);
    database.prepare("INSERT INTO erp_skus(id,merchantSkuCode,erpGoodsId,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES('suite-erp-a','HP0059-10','suite-goods-a','{}','suite-erp-batch','suite-erp-batch','active',?,?),('suite-erp-b','FZH0103-2','suite-goods-b','{}','suite-erp-batch','suite-erp-batch','active',?,?)").run(stamp, stamp, stamp, stamp);
    const task = database.prepare("SELECT id FROM data_sync_tasks WHERE taskCode='wangdian_suites'").get();
    const payload = (flowerQuantity = 5, extra = []) => ({ status: 0, data: { total_count: 1, suite_list: [{
      suite_id: 486, suite_no: "FZH0103-11", suite_name: "透明小花瓶+白色郁金香5支", suite_modified: "2026-08-20 10:30:27", deleted: 0,
      detail_list: [
        { rec_id: 1, spec_id: 646, spec_no: "HP0059-10", spec_name: "透明小花瓶", num: 1, deleted: 0 },
        { rec_id: 2, spec_id: 308, spec_no: "FZH0103-2", spec_name: "白色郁金香", num: flowerQuantity, deleted: 0 },
        ...extra,
      ],
    }] } });
    const first = await syncWangdianSuites({ taskId: task.id, suiteNo: "FZH0103-11", syncMode: "incremental", createdBy: reviewer.id }, { database, querySuites: async () => payload() });
    assert.equal(first.result.createdCount, 1);
    assert.equal(first.result.structuresCreated, 1);
    assert.equal(first.result.componentsCreated, 2);
    assert.equal(first.result.relationsCreated, 1);
    const object = database.prepare("SELECT * FROM sales_objects WHERE normalizedObjectCode='fzh0103-11'").get();
    assert.equal(object.sourceType, "wangdian_suite_api");
    assert.equal(database.prepare("SELECT COUNT(*) total FROM sales_object_structures WHERE salesObjectId=?").get(object.id).total, 1);
    assert.equal(database.prepare("SELECT COUNT(*) total FROM sales_link_sku_sales_object_relations WHERE linkSkuId='suite-link-sku' AND status='active'").get().total, 1);

    const repeated = await syncWangdianSuites({ taskId: task.id, suiteNo: "FZH0103-11", syncMode: "incremental", createdBy: reviewer.id }, { database, querySuites: async () => payload() });
    assert.equal(repeated.result.unchangedCount, 1);
    assert.equal(repeated.result.structuresCreated, 0);
    assert.equal(database.prepare("SELECT COUNT(*) total FROM sales_object_structures WHERE salesObjectId=?").get(object.id).total, 1);

    const changed = await syncWangdianSuites({ taskId: task.id, suiteNo: "FZH0103-11", syncMode: "incremental", createdBy: reviewer.id }, { database, querySuites: async () => payload(6) });
    assert.equal(changed.result.updatedCount, 1);
    assert.equal(changed.result.structuresCreated, 1);
    assert.deepEqual(database.prepare("SELECT version,status FROM sales_object_structures WHERE salesObjectId=? ORDER BY version").all(object.id), [{ version: 1, status: "superseded" }, { version: 2, status: "active" }]);
    assert.equal(database.prepare("SELECT quantity FROM sales_object_structure_components c JOIN sales_object_structures s ON s.id=c.structureId WHERE s.salesObjectId=? AND s.status='active' AND c.erpSkuId='suite-erp-b'").get(object.id).quantity, 6);

    const blocked = await syncWangdianSuites({ taskId: task.id, suiteNo: "FZH0103-11", syncMode: "incremental", createdBy: reviewer.id }, { database, querySuites: async () => payload(6, [{ rec_id: 3, spec_no: "ERP-MISSING", num: 1, deleted: 0 }]) });
    assert.equal(blocked.dataSyncBatch.status, "partial");
    assert.equal(blocked.result.exceptions[0].exceptionType, "suite_structure_incomplete");
    assert.equal(database.prepare("SELECT COUNT(*) total FROM sales_object_structures WHERE salesObjectId=?").get(object.id).total, 2, "异常结构不得覆盖当前正式结构");
    assert.equal(database.prepare("SELECT COUNT(*) total FROM connection_sku_sales_daily_facts").get().total, 0);
    assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
    assert.equal(database.pragma("foreign_key_check").length, 0);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
