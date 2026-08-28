import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { getDatabase } from "../server/db.js";
import { getConnectionBusinessCockpit } from "../server/connectionBusinessCockpitService.js";
import { listProductCenterV2Skus } from "../server/productCenterV2Service.js";
import { resolveErpSkuSalesObjectLinks } from "../server/capabilities/resolveLinkSkuRelationRead.js";
import { readWorkResultsInitial } from "../server/workManagementPageService.js";

if (!process.env.WUFAN_DB_PATH) throw new Error("WUFAN_DB_PATH必须指向最新生产数据库隔离副本。");

const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
const percentile = (values, ratio) => [...values].sort((left, right) => left - right)[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)];
const timed = (read) => { const startedAt = performance.now(); const value = read(); return { value, milliseconds: performance.now() - startedAt }; };

if (process.argv.includes("--product-cold")) {
  const product = timed(() => listProductCenterV2Skus({ limit: 50, offset: 0, sort: "updated-desc" }));
  process.stdout.write(JSON.stringify({ milliseconds: product.milliseconds, bytes: bytes(product.value), rows: product.value.rows.length }));
  process.exit(0);
}

const coldProcess = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--product-cold"], {
  env: process.env, encoding: "utf8", timeout: 30_000,
});
assert.equal(coldProcess.status, 0, coldProcess.stderr || "产品冷请求隔离进程失败");
const productCold = JSON.parse(coldProcess.stdout);
assert.equal(productCold.rows, 50);
assert.ok(productCold.milliseconds < 1_500, `产品一次性冷启动不得超过1.5秒，实际${productCold.milliseconds.toFixed(1)}ms`);
assert.ok(productCold.bytes < 500_000, `产品列表应小于500KB，实际${productCold.bytes}B`);

const full = timed(() => getConnectionBusinessCockpit("", true, { preset: "30d" }));
const coreSamples = [];
let core;
for (let index = 0; index < 7; index += 1) {
  const result = timed(() => getConnectionBusinessCockpit("", true, { preset: "30d", scope: "core" }));
  core = result.value; coreSamples.push(result.milliseconds);
}
const productChannels = timed(() => getConnectionBusinessCockpit("", true, { preset: "30d", scope: "product-channels" }));
assert.deepEqual(core.summary, full.value.summary, "驾驶舱轻量首屏不得改变经营汇总口径");
assert.deepEqual(core.ratingSummary, full.value.ratingSummary, "驾驶舱轻量首屏不得改变评级汇总口径");
assert.deepEqual(core.shopOperations, full.value.shopOperations, "驾驶舱轻量首屏不得改变店铺经营口径");
assert.deepEqual(core.ownerOperations, full.value.ownerOperations, "驾驶舱轻量首屏不得改变负责人贡献口径");
assert.deepEqual(core.platforms, full.value.platforms, "驾驶舱轻量首屏不得改变平台经营口径");
assert.deepEqual(core.trends, full.value.trends, "驾驶舱轻量首屏不得改变趋势口径");
assert.deepEqual(productChannels.value.productChannels, full.value.productChannels, "按需产品渠道结果必须与原完整结果一致");
assert.equal(core.productChannels.length, 0, "产品渠道不得进入驾驶舱首屏");
assert.ok(bytes(core) < 100_000, `驾驶舱核心首屏应小于100KB，实际${bytes(core)}B`);
const cockpitP50 = percentile(coreSamples, 0.5); const cockpitP95 = percentile(coreSamples, 0.95);
assert.ok(cockpitP95 < 1_000, `驾驶舱核心首屏P95应小于1秒，实际${cockpitP95.toFixed(1)}ms`);

const product = listProductCenterV2Skus({ limit: 50, offset: 0, sort: "updated-desc" });
const erpSkuIds = product.rows.map((row) => row.erpSkuId);
const reverse = resolveErpSkuSalesObjectLinks({ erpSkuIds }, { database: getDatabase(), scope: "productAssociations", salesObjectOnly: true }).results;
const linkSkuIds = [...new Set(Object.values(reverse).flatMap((relations) => relations.map((relation) => relation.salesLinkSkuId)).filter(Boolean))];
const linkIdentity = new Map(linkSkuIds.length ? getDatabase().prepare(`SELECT x.id,x.salesLinkId,sh.platform FROM sales_link_skus x JOIN sales_links l ON l.id=x.salesLinkId JOIN sales_shops sh ON sh.id=l.shopId WHERE x.id IN (${linkSkuIds.map(() => "?").join(",")})`).all(...linkSkuIds).map((row) => [row.id, row]) : []);
for (const row of product.rows) {
  const identities = (reverse[row.erpSkuId] || []).map((relation) => linkIdentity.get(relation.salesLinkSkuId)).filter(Boolean);
  assert.equal(row.linkCount, new Set(identities.map((item) => item.salesLinkId)).size, `产品${row.erpSkuId}链接数必须与正式Resolver一致`);
  assert.equal(row.platformSkuCount, new Set(identities.map((item) => item.id)).size, `产品${row.erpSkuId}平台SKU数必须与正式Resolver一致`);
  assert.deepEqual(new Set(row.platforms), new Set(identities.map((item) => item.platform)), `产品${row.erpSkuId}平台范围必须与正式Resolver一致`);
}

const workResults = readWorkResultsInitial({ days: 7 });
const workResultBytes = bytes(workResults);
assert.ok(workResultBytes <= 1_100_000, `工作结果兼容首屏不得超过1.1MB，实际${workResultBytes}B`);
assert.ok(workResults.data.tasks.length <= 1_000 && workResults.data.workPlans.length <= 100, "工作结果首屏必须继续使用有界摘要");

const integrity = getDatabase().pragma("integrity_check", { simple: true });
const foreignKeys = getDatabase().pragma("foreign_key_check");
assert.equal(integrity, "ok"); assert.deepEqual(foreignKeys, []);

console.log(JSON.stringify({
  success: true,
  cockpit: {
    originalFullMs: Number(full.milliseconds.toFixed(1)), originalFullBytes: bytes(full.value),
    coreP50: Number(cockpitP50.toFixed(1)), coreP95: Number(cockpitP95.toFixed(1)), coreBytes: bytes(core),
    productChannelsMs: Number(productChannels.milliseconds.toFixed(1)), productChannelsBytes: bytes(productChannels.value),
  },
  product: { coldMs: Number(productCold.milliseconds.toFixed(1)), coldStatus: productCold.milliseconds < 1_000 ? "target" : "accepted-one-time-cold-start", bytes: productCold.bytes, resolverRowsVerified: product.rows.length },
  workResults: { bytes: workResultBytes, tasks: workResults.data.tasks.length, processInstances: workResults.data.processInstances.length, workPlans: workResults.data.workPlans.length },
  database: { integrity, foreignKeyViolations: foreignKeys.length },
}, null, 2));
