import { performance } from "node:perf_hooks";
import { getDatabase, readAllData, readResource } from "../server/db.js";
import { goalCenterBootstrapResources } from "../server/goalCenterBootstrapService.js";
import { listProductCenterV2Skus } from "../server/productCenterV2Service.js";
import { listConnectionCoreProfilesPage } from "../server/connectionCorePageService.js";
import { readTemplateCenterUsageSummary } from "../server/templateCenterBootstrapService.js";

if (!process.env.WUFAN_DB_PATH) throw new Error("WUFAN_DB_PATH必须指向隔离验证数据库。");

const commonResources = [
  "companies", "departments", "positions", "people", "permissionTemplates", "categories", "stores",
  "publishingAccounts", "taskTemplates", "processTemplates", "processTemplateNodes",
  "templates", "templateTagCategories", "templateTags", "issuesRequirements", "standardWorkForms",
];

const currentModuleResources = {
  dashboard: commonResources,
  products: commonResources,
  connectionCenter: [...commonResources, "goals"],
  tasks: commonResources.filter((key) => !["notifications", "templates", "templateTagCategories", "templateTags", "issuesRequirements"].includes(key)).concat("goals"),
  scheduleBoard: [...commonResources, "goals", "tasks", "processInstances", "workPlans", "contentSchedules", "actionProducts"],
  financeCenter: commonResources,
  processes: ["categories", "departments", "goals", "methodologies", "people", "positions", "processInstances", "processTemplateNodes", "processTemplates", "taskTemplates", "tasks", "workPlans"],
  settings: ["companies", "departments", "positions", "people", "permissionTemplates", "categories", "stores", "publishingAccounts", "taskTemplates", "templateTagCategories", "templateTags", "issuesRequirements", "standardWorkForms"],
  templateCenter: ["taskTemplates", "processTemplates", "processTemplateNodes", "methodologies", "templates", "templateTagCategories", "templateTags", "standardWorkForms"],
  goals: goalCenterBootstrapResources,
};

const percentile = (values, ratio) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
};

function measure(name, read, samples = 3) {
  const timings = [];
  let value;
  for (let index = 0; index < samples; index += 1) {
    const startedAt = performance.now();
    value = read();
    timings.push(performance.now() - startedAt);
  }
  return {
    name,
    bytes: Buffer.byteLength(JSON.stringify(value) ?? "null"),
    p50: Number(percentile(timings, 0.5).toFixed(1)),
    p95: Number(percentile(timings, 0.95).toFixed(1)),
    samples: timings.map((value) => Number(value.toFixed(1))),
  };
}

function readResources(keys) {
  return Object.fromEntries([...new Set(keys)].map((key) => [key, readResource(key)]));
}

const database = getDatabase();
const counts = Object.fromEntries([
  "goals", "tasks", "process_instances", "work_plans", "products", "erp_skus", "sales_links",
].map((table) => [table, Number(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count)]));

const resources = Object.fromEntries([
  "tasks", "processInstances", "workPlans", "notifications", "products", "erpGoods", "productErpMappings",
  "templates", "taskTemplates", "processTemplates", "processTemplateNodes", "people", "permissionTemplates",
].map((key) => [key, measure(`resource:${key}`, () => readResource(key), 1)]));

const bootstraps = Object.fromEntries(Object.entries(currentModuleResources).map(([moduleName, keys]) => [
  moduleName,
  measure(`bootstrap:${moduleName}`, () => ({
    ...readResources(keys),
    ...(moduleName === "templateCenter" ? { templateCenterUsageSummary: readTemplateCenterUsageSummary() } : {}),
  }), 2),
]));

const globalSnapshot = measure("global-snapshot", () => readAllData({ exclude: ["salesLinks", "salesLinkSkus"] }), 1);
const productPage = measure("product-page-50", () => listProductCenterV2Skus({ limit: 50, offset: 0, sort: "updated-desc" }), 5);
const connectionPage = measure("connection-page-50", () => listConnectionCoreProfilesPage({ page: 1, pageSize: 50 }, "", true), 5);
const sqliteProbe = measure("sqlite-primary-key-probe", () => database.prepare("SELECT id FROM tasks WHERE id = ?").get("missing"), 20);

console.log(JSON.stringify({
  measuredAt: new Date().toISOString(),
  databasePath: process.env.WUFAN_DB_PATH,
  counts,
  resources,
  bootstraps,
  globalSnapshot,
  pages: { productPage, connectionPage },
  sqliteProbe,
  memory: process.memoryUsage(),
}, null, 2));
