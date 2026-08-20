import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { enrichOperatingErpObjects } from "../server/v3WangdianOperatingEnrichmentService.js";

function fixture(checkedAt = "2026-08-21T00:00:00.000Z") {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE operating_erp_set_members(merchantSkuCode TEXT,normalizedCode TEXT,lifecycleStatus TEXT);
    CREATE TABLE erp_skus(id TEXT,merchantSkuCode TEXT,currentState TEXT);
    CREATE TABLE sales_objects(id TEXT,normalizedObjectCode TEXT,status TEXT,sourceType TEXT);
    CREATE TABLE operating_erp_identity_observations(
      normalizedCode TEXT,merchantSkuCode TEXT,identityStatus TEXT,sourceCheckedAt TEXT
    );
    INSERT INTO operating_erp_set_members VALUES('MISSING','missing','unresolved');
  `);
  database.prepare("INSERT INTO operating_erp_identity_observations VALUES('missing','MISSING','erp_not_found',?)").run(checkedAt);
  return database;
}

test("近期Goods与Suite均不存在的编码命中负缓存且不重复请求", async () => {
  const database = fixture();
  let requests = 0;
  const result = await enrichOperatingErpObjects({}, {
    database,
    now: "2026-08-21T01:00:00.000Z",
    negativeCacheTtlMs: 6 * 60 * 60 * 1000,
    queryGoods: async () => { requests += 1; return {}; },
    querySuites: async () => { requests += 1; return {}; },
  });
  assert.equal(requests, 0);
  assert.equal(result.cacheHits, 1);
  assert.equal(result.changedCodes, 0);
  assert.equal(result.liveObservations.missing.goodsChecked, true);
  assert.equal(result.liveObservations.missing.suiteChecked, true);
  database.close();
});

test("负缓存过期后重新查询Goods与Suite", async () => {
  const database = fixture("2026-08-20T00:00:00.000Z");
  let goodsRequests = 0;
  let suiteRequests = 0;
  const result = await enrichOperatingErpObjects({}, {
    database,
    now: "2026-08-21T01:00:00.000Z",
    negativeCacheTtlMs: 6 * 60 * 60 * 1000,
    queryGoods: async () => { goodsRequests += 1; return {}; },
    querySuites: async () => { suiteRequests += 1; return { data: { order: [] } }; },
  });
  assert.equal(goodsRequests, 1);
  assert.equal(suiteRequests, 1);
  assert.equal(result.cacheHits, 0);
  assert.equal(result.changedCodes, 1);
  assert.equal(result.estimatedApiRequests, 2);
  database.close();
});
