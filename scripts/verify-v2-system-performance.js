import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { getDatabase, readResource } from "../server/db.js";
import { listConnectionCoreProfilesPage } from "../server/connectionCorePageService.js";
import { listProductCenterV2Skus } from "../server/productCenterV2Service.js";
import { readNotificationSummary } from "../server/notificationSummaryService.js";
import { readTemplateCenterUsageSummary } from "../server/templateCenterBootstrapService.js";

if (!process.env.WUFAN_DB_PATH) throw new Error("WUFAN_DB_PATH必须指向隔离验证数据库。");

const percentile = (values, ratio) => [...values].sort((left, right) => left - right)[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)];
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
const latest = (items, readDate) => items.map(readDate).filter(Boolean).sort().at(-1) ?? "";
const usage = (items, readDate) => ({ useCount: items.length, lastUsedAt: latest(items, readDate) });
const measure = (read, samples = 7) => {
  const timings = [];
  let value;
  for (let index = 0; index < samples; index += 1) {
    const startedAt = performance.now();
    value = read();
    timings.push(performance.now() - startedAt);
  }
  return { value, p50: percentile(timings, 0.5), p95: percentile(timings, 0.95), samples: timings };
};
const readSet = (keys) => Object.fromEntries(keys.map((key) => [key, readResource(key)]));

const database = getDatabase();
const settingsBootstrap = readSet(["companies", "departments", "positions", "people", "permissionTemplates", "categories", "stores", "publishingAccounts", "taskTemplates", "templateTagCategories", "templateTags", "issuesRequirements", "standardWorkForms"]);
const templateBootstrap = {
  ...readSet(["taskTemplates", "processTemplates", "processTemplateNodes", "methodologies", "templates", "templateTagCategories", "templateTags", "standardWorkForms"]),
  templateCenterUsageSummary: readTemplateCenterUsageSummary({ database }),
};
assert.ok(bytes(settingsBootstrap) < 500_000, `设置启动数据应小于500KB，实际${bytes(settingsBootstrap)}B`);
assert.ok(bytes(templateBootstrap) < 1_000_000, `模板中心启动数据应小于1MB，实际${bytes(templateBootstrap)}B`);

const tasks = readResource("tasks");
const instances = readResource("processInstances");
const summary = templateBootstrap.templateCenterUsageSummary;
for (const template of readResource("taskTemplates")) {
  const actionItems = instances.filter((item) => item.taskTemplateId === template.id || item.templateId === template.defaultProcessTemplateId);
  assert.deepEqual(summary.actionByTaskTemplateId[template.id], usage(actionItems, (item) => item.startedAt || item.createdAt), `行动模板${template.id}使用摘要不一致`);
  const taskItems = tasks.filter((item) => item.taskTemplateId === template.id);
  const expected = usage(taskItems, (item) => item.completedAt || item.updatedAt || item.createdAt);
  assert.deepEqual(summary.formByStandardWorkId[template.id], expected, `表单${template.id}使用摘要不一致`);
  const taskTemplateItems = tasks.filter((item) => item.taskTemplateId === template.id);
  if (summary.taskByTaskTemplateId[template.id] !== undefined) {
    assert.deepEqual(summary.taskByTaskTemplateId[template.id], usage(taskTemplateItems, (item) => item.completedAt || item.updatedAt || item.createdAt), `任务模板${template.id}使用摘要不一致`);
  }
}
for (const methodology of readResource("methodologies")) {
  const items = tasks.filter((item) => item.processNodeId === methodology.processNodeId || item.taskTemplateId === methodology.taskTemplateId);
  assert.deepEqual(summary.methodologyById[methodology.id], usage(items, (item) => item.completedAt || item.updatedAt || item.createdAt), `方法论${methodology.id}使用摘要不一致`);
}

const notificationOwner = database.prepare("SELECT userId,COUNT(*) count FROM notifications GROUP BY userId ORDER BY count DESC LIMIT 1").get();
const notificationSummary = readNotificationSummary(notificationOwner?.userId, { database, limit: 12 });
assert.ok(notificationSummary.items.length <= 12);
assert.ok(bytes(notificationSummary) < 100_000, `通知摘要应小于100KB，实际${bytes(notificationSummary)}B`);

const connection = measure(() => listConnectionCoreProfilesPage({ page: 1, pageSize: 50 }, "", true));
assert.equal(connection.value.items.length, 50);
assert.ok(bytes(connection.value) < 500_000);
assert.ok(connection.p50 < 300, `链接列表P50应小于300ms，实际${connection.p50.toFixed(1)}ms`);
assert.ok(connection.p95 < 1_000, `链接列表P95应小于1s，实际${connection.p95.toFixed(1)}ms`);

const product = measure(() => listProductCenterV2Skus({ limit: 50, offset: 0, sort: "updated-desc" }), 5);
assert.equal(product.value.rows.length, 50);
assert.ok(bytes(product.value) < 500_000);
assert.ok(product.p50 < 300, `产品列表P50应小于300ms，实际${product.p50.toFixed(1)}ms`);
assert.ok(product.p95 < 1_000, `产品列表P95应小于1s，实际${product.p95.toFixed(1)}ms`);

const mainSource = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
for (const file of ["dashboardPage", "goalsPage", "scheduleBoardPage", "processesPage", "methodologiesPage", "templateCenterPage", "financeCenterPage", "settingsPage"]) {
  assert.doesNotMatch(mainSource, new RegExp(`from [\"']\\./${file}\\.js[\"']`, "u"), `${file}不应由入口同步加载`);
}

console.log(JSON.stringify({
  success: true,
  payloads: {
    settings: bytes(settingsBootstrap),
    templateCenter: bytes(templateBootstrap),
    notifications: bytes(notificationSummary),
  },
  pages: {
    connection: { bytes: bytes(connection.value), p50: Number(connection.p50.toFixed(1)), p95: Number(connection.p95.toFixed(1)) },
    product: { bytes: bytes(product.value), p50: Number(product.p50.toFixed(1)), p95: Number(product.p95.toFixed(1)) },
  },
  dynamicPageSourceBytes: ["dashboardPage", "goalsPage", "scheduleBoardPage", "processesPage", "methodologiesPage", "templateCenterPage", "financeCenterPage", "settingsPage"]
    .reduce((sum, file) => sum + fs.statSync(new URL(`../src/${file}.js`, import.meta.url)).size, 0),
}, null, 2));
