import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const appState = read("src/appState.js");
const server = read("server/index.js");
const financePage = read("src/financeCenterPage.js");
const dataCenterPage = read("src/dataCenterPage.js");

assert.match(
  appState,
  /const lightweightModules = new Set\(\[[\s\S]*?"financeCenter"[\s\S]*?"finance-center"[\s\S]*?"dataCenter"[\s\S]*?"data-center"[\s\S]*?\]\);/,
  "财务中心和数据中心必须通过轻量模块启动，不能回落到 /api/data。",
);
assert.match(appState, /"finance-center":\s*"financeCenter"/, "财务中心兼容路由必须映射到轻量模块名。");
assert.match(appState, /"data-center":\s*"dataCenter"/, "数据中心兼容路由必须映射到轻量模块名。");
assert.match(server, /financeCenter:\s*\[\]/, "服务端必须注册财务中心轻量 bootstrap。");
assert.match(server, /dataCenter:\s*\[\]/, "服务端必须注册数据中心轻量 bootstrap。");

assert.doesNotMatch(financePage, /loadPersistentData|\/api\/data(?:["'`/?])/, "财务页面不得触发全局快照。");
assert.doesNotMatch(dataCenterPage, /loadPersistentData|\/api\/data(?:["'`/?])/, "数据中心页面不得触发全局快照。");

for (const financeLoader of [
  "loadFinanceStatement",
  "loadFinanceAnalysis",
  "loadFinanceEntries",
  "loadFinanceImportBatches",
  "loadFinanceRules",
]) {
  assert.match(financePage, new RegExp(`\\b${financeLoader}\\b`), `财务中心缺少专用数据源 ${financeLoader}。`);
}

for (const dataCenterLoader of ["loadDataCenterView", "loadDataSyncCenter", "loadDataCenterProductDetail"]) {
  assert.match(dataCenterPage, new RegExp(`\\b${dataCenterLoader}\\b`), `数据中心缺少专用数据源 ${dataCenterLoader}。`);
}

console.log(JSON.stringify({
  success: true,
  modules: ["financeCenter", "dataCenter"],
  globalSnapshotReferencedByPages: false,
  financeDataSource: "finance dedicated APIs",
  dataCenterDataSource: "data-center and data-sync-center dedicated APIs",
}, null, 2));
