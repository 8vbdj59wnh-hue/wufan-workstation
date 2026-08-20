import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const projectRoot = process.env.WUFAN_PROJECT_ROOT || "/Users/meiyounaichatouyuna/Projects/goal-execution-system";
const databasePath = process.env.WUFAN_DB_PATH || "/Users/meiyounaichatouyuna/WufanWorkstationData/production/workstation.db";
const outputPath = process.env.OUTPUT_PATH || "/private/tmp/operating-erp-phase2-live.json";
const require = createRequire(`${projectRoot}/package.json`);
const Database = require("better-sqlite3");
const { adaptWangdianGoodsResponse } = await import(pathToFileURL(`${projectRoot}/server/wangdianGoodsAdapter.js`));
const { queryWangdianGoods, queryWangdianSuites, readWangdianConfig } = await import(pathToFileURL(`${projectRoot}/server/wangdianClient.js`));
const { searchWangdianSuites } = await import(pathToFileURL(`${projectRoot}/server/wangdianSuiteService.js`));

const pm2 = JSON.parse(execFileSync("pm2", ["jlist"], { encoding: "utf8" }));
const server = pm2.find((item) => item.name === "wufan-server");
if (!server) throw new Error("wufan-server_pm2_process_missing");
const config = readWangdianConfig(server.pm2_env);
const db = new Database(databasePath, { readonly: true, fileMustExist: true });
db.pragma("query_only=ON");
const latestBatch = db.prepare(`SELECT id,businessDate,completedAt,createdAt FROM erp_import_batches
  WHERE importType='platform_goods' AND status='completed' AND (importMode IS NULL OR trim(importMode)='' OR importMode='full')
  ORDER BY COALESCE(businessDate,substr(completedAt,1,10),substr(createdAt,1,10)) DESC,COALESCE(completedAt,createdAt) DESC LIMIT 1`).get();
if (!latestBatch) throw new Error("latest_complete_platform_batch_missing");

const normalize = (value) => String(value ?? "").trim().replace(/\.0+$/u, "").toLowerCase();
const unresolved = db.prepare(`SELECT DISTINCT COALESCE(NULLIF(s.normalizedPlatformSkuCode,''),s.platformSkuCode) code
  FROM sales_link_skus s
  LEFT JOIN erp_skus e ON lower(trim(e.merchantSkuCode))=lower(trim(COALESCE(NULLIF(s.normalizedPlatformSkuCode,''),s.platformSkuCode)))
  LEFT JOIN sales_objects o ON lower(trim(o.normalizedObjectCode))=lower(trim(COALESCE(NULLIF(s.normalizedPlatformSkuCode,''),s.platformSkuCode))) AND o.status='active'
  WHERE s.lastSeenBatchId=? AND trim(COALESCE(NULLIF(s.normalizedPlatformSkuCode,''),s.platformSkuCode,''))<>'' AND e.id IS NULL AND o.id IS NULL
  ORDER BY code`).all(latestBatch.id).map((item) => String(item.code));
const legacyBundles = db.prepare(`SELECT DISTINCT o.objectCode code
  FROM sales_link_skus s
  JOIN sales_link_sku_sales_object_relations r ON r.linkSkuId=s.id AND r.status='active'
  JOIN sales_objects o ON o.id=r.salesObjectId AND o.objectType='bundle' AND o.status='active' AND o.sourceType<>'wangdian_suite_api'
  WHERE s.lastSeenBatchId=? ORDER BY o.objectCode`).all(latestBatch.id).map((item) => String(item.code));
const codeType = new Map();
for (const code of unresolved) codeType.set(normalize(code), { code, reason: "unresolved" });
for (const code of legacyBundles) codeType.set(normalize(code), { code, reason: "legacy_bundle" });

const observations = {};
let completed = 0;
const targets = [...codeType.values()];
async function verifyTarget({ code, reason }) {
  const observation = { code, reason, checkedAt: new Date().toISOString(), goodsChecked: false, suiteChecked: false, goods: null, suite: null, goodsError: null, suiteError: null };
  const goodsPromise = reason === "unresolved"
    ? (async () => { try {
      const payload = await queryWangdianGoods({ params: { spec_no: code, hide_deleted: 0 }, pageSize: 100, config });
      const exact = adaptWangdianGoodsResponse(payload).filter((item) => normalize(item.merchantSkuCode) === normalize(code));
      observation.goods = exact[0] || null;
      observation.goodsMatchCount = exact.length;
      observation.goodsChecked = true;
    } catch (error) {
      observation.goodsError = error.message || String(error);
    } })()
    : Promise.resolve().then(() => {
      observation.goodsChecked = true;
      observation.goods = null;
      observation.goodsBasis = "materialized_goods_snapshot_not_found";
    });
  const suitePromise = (async () => { try {
    const result = await searchWangdianSuites({ suiteNo: code, pageSize: 100, hideDeleted: false }, {
      querySuites: (query) => queryWangdianSuites({ ...query, config }),
    });
    const exact = result.items.filter((item) => normalize(item.suiteCode) === normalize(code));
    observation.suite = exact[0] || null;
    observation.suiteMatchCount = exact.length;
    observation.suiteChecked = true;
  } catch (error) {
    observation.suiteError = error.message || String(error);
  } })();
  await Promise.all([goodsPromise, suitePromise]);
  observations[normalize(code)] = observation;
  completed += 1;
  if (completed % 25 === 0) process.stderr.write(`verified ${completed}/${targets.length}\n`);
}
let cursor = 0;
const workers = Array.from({ length: Math.min(12, targets.length) }, async () => {
  while (cursor < targets.length) {
    const target = targets[cursor];
    cursor += 1;
    await verifyTarget(target);
  }
});
await Promise.all(workers);

const result = {
  generatedAt: new Date().toISOString(),
  databasePath,
  latestBatch,
  targetSummary: { unresolved: unresolved.length, legacyBundles: legacyBundles.length, distinctTargets: codeType.size },
  observations,
};
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
process.stdout.write(JSON.stringify({ outputPath, ...result.targetSummary, completed }));
db.close();
