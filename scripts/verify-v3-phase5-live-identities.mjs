import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const projectRoot = process.env.WUFAN_PROJECT_ROOT || "/Users/meiyounaichatouyuna/Projects/goal-execution-system";
const targetsPath = process.env.TARGETS_PATH || "/private/tmp/v3-phase5-live-targets.json";
const outputPath = process.env.OUTPUT_PATH || "/private/tmp/v3-phase5-live-observations.json";
const require = createRequire(`${projectRoot}/package.json`);
void require;
const { adaptWangdianGoodsResponse } = await import(pathToFileURL(`${projectRoot}/server/wangdianGoodsAdapter.js`));
const { queryWangdianGoods, queryWangdianSuites, readWangdianConfig } = await import(pathToFileURL(`${projectRoot}/server/wangdianClient.js`));
const { searchWangdianSuites } = await import(pathToFileURL(`${projectRoot}/server/wangdianSuiteService.js`));

const pm2 = JSON.parse(execFileSync("pm2", ["jlist"], { encoding: "utf8" }));
const server = pm2.find((item) => item.name === "wufan-server");
if (!server) throw new Error("wufan-server_pm2_process_missing");
const config = readWangdianConfig(server.pm2_env);
const normalize = (value) => String(value ?? "").trim().replace(/\.0+$/u, "").toLowerCase();
const targets = JSON.parse(fs.readFileSync(targetsPath, "utf8"));
const observations = {};
let completed = 0;

async function verify({ code }) {
  const observation = { code, checkedAt: new Date().toISOString(), goodsChecked: false, suiteChecked: false, goods: null, suite: null, goodsError: null, suiteError: null };
  await Promise.all([
    (async () => { try {
      const payload = await queryWangdianGoods({ params: { spec_no: code, hide_deleted: 0 }, pageSize: 100, config });
      const exact = adaptWangdianGoodsResponse(payload).filter((item) => normalize(item.merchantSkuCode) === normalize(code));
      observation.goods = exact[0] || null; observation.goodsMatchCount = exact.length; observation.goodsChecked = true;
    } catch (error) { observation.goodsError = error.message || String(error); } })(),
    (async () => { try {
      const result = await searchWangdianSuites({ suiteNo: code, pageSize: 100, hideDeleted: false }, { querySuites: (query) => queryWangdianSuites({ ...query, config }) });
      const exact = result.items.filter((item) => normalize(item.suiteCode) === normalize(code));
      observation.suite = exact[0] || null; observation.suiteMatchCount = exact.length; observation.suiteChecked = true;
    } catch (error) { observation.suiteError = error.message || String(error); } })(),
  ]);
  observations[normalize(code)] = observation;
  completed += 1;
  if (completed % 25 === 0) process.stderr.write(`verified ${completed}/${targets.length}\n`);
}

let cursor = 0;
const workers = Array.from({ length: Math.min(10, targets.length) }, async () => {
  while (cursor < targets.length) { const target = targets[cursor]; cursor += 1; await verify(target); }
});
await Promise.all(workers);
const rows = Object.values(observations);
const summary = {
  targeted: targets.length, completed,
  goodsFound: rows.filter((item) => item.goods && !item.suite).length,
  suitesFound: rows.filter((item) => item.suite && !item.goods).length,
  typeConflicts: rows.filter((item) => item.goods && item.suite).length,
  notFound: rows.filter((item) => !item.goods && !item.suite && !item.goodsError && !item.suiteError).length,
  apiFailures: rows.filter((item) => item.goodsError || item.suiteError).length,
};
fs.writeFileSync(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, observations }, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, summary }));
