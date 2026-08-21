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
    CREATE TABLE sales_object_structures(id TEXT,salesObjectId TEXT,status TEXT);
    CREATE TABLE sales_object_structure_components(id TEXT,structureId TEXT,erpSkuId TEXT,quantity REAL,sortOrder INTEGER,status TEXT);
    CREATE TABLE operating_erp_identity_observations(
      normalizedCode TEXT,merchantSkuCode TEXT,identityStatus TEXT,sourceCheckedAt TEXT,sourceUpdatedAt TEXT,
      resolvedIdentityType TEXT,goodsStatus TEXT,suiteStatus TEXT,goodsErpSkuId TEXT,suiteSalesObjectId TEXT
    );
    INSERT INTO operating_erp_set_members VALUES('MISSING','missing','unresolved');
  `);
  database.prepare("INSERT INTO operating_erp_identity_observations VALUES('missing','MISSING','erp_not_found',?,NULL,'unresolved','not_found','not_found',NULL,NULL)").run(checkedAt);
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

test("近期已确认Bundle身份复用当前结构且不重复请求", async () => {
  const database = fixture();
  database.exec(`
    INSERT INTO operating_erp_set_members VALUES('PACK','pack','active');
    INSERT INTO erp_skus VALUES('erp-a','A','active');
    INSERT INTO sales_objects VALUES('so-pack','pack','active','legacy_excel');
    INSERT INTO sales_object_structures VALUES('st-pack','so-pack','active');
    INSERT INTO sales_object_structure_components VALUES('c-a','st-pack','erp-a',2,1,'active');
    INSERT INTO operating_erp_identity_observations VALUES(
      'pack','PACK','confirmed','2026-08-21T00:00:00.000Z','2026-08-20T23:00:00.000Z',
      'bundle','not_found','found',NULL,'so-pack'
    );
  `);
  let requests = 0;
  const result = await enrichOperatingErpObjects({}, {
    database, now: "2026-08-21T01:00:00.000Z", identityCacheTtlMs: 6 * 60 * 60 * 1000,
    queryGoods: async () => { requests += 1; return {}; },
    querySuites: async () => { requests += 1; return {}; },
  });
  assert.equal(requests, 0);
  assert.equal(result.identityCacheHits, 1);
  assert.deepEqual(result.liveObservations.pack.suite.components.map((item) => [item.skuCode, item.quantity]), [["A", 2]]);
  assert.deepEqual(result.bundleSources.pack.components, [{ erpSkuId: "erp-a", skuCode: "A", quantity: 2 }]);
  assert.equal(result.bundleSources.pack.sourceUpdatedAt, "2026-08-20T23:00:00.000Z");
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
