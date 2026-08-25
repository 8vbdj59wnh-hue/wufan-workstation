import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { goalCenterBootstrapResources } from "../server/goalCenterBootstrapService.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const appState = read("src/appState.js");
const server = read("server/index.js");
const service = read("server/goalCenterBootstrapService.js");

assert.match(
  appState,
  /goals:\s*`\$\{apiBaseUrl\}\/api\/goal-center\/bootstrap`/,
  "目标管理路由必须使用独立接口。",
);
assert.match(
  appState,
  /preserveMissingResources:\s*moduleDataEndpoint !== null/,
  "模块响应不得清空未声明的其他模块状态。",
);
assert.match(
  server,
  /app\.get\("\/api\/goal-center\/bootstrap",\s*requirePermission\("goals\.view"\)/,
  "服务端缺少受目标模块权限保护的独立读接口。",
);
assert.match(server, /app\.get\("\/api\/data"/, "渐进拆分期间不得删除旧 /api/data 接口。");
assert.doesNotMatch(
  service,
  /readAllData|\/api\/data/,
  "目标管理服务不得借道全局快照。",
);

console.log(JSON.stringify({
  success: true,
  migratedModule: "goals",
  endpoint: "/api/goal-center/bootstrap",
  declaredResourceCount: goalCenterBootstrapResources.length,
  legacyApiRetained: true,
  undeclaredStatePreserved: true,
}, null, 2));
