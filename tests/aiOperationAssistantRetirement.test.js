import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");
const exists = (path) => fs.existsSync(new URL(path, root));

test("独立AI经营助手不再注册导航、路由、页面或前端数据调用", () => {
  const modules = read("src/modules.js");
  const main = read("src/main.js");
  const appState = read("src/appState.js");

  for (const source of [modules, main, appState]) {
    assert.doesNotMatch(source, /aiOperationAssistant|ai-operation-assistant|\/api\/ai-operation/);
  }
  for (const path of [
    "src/aiOperationAssistantPage.js",
    "src/pages/aiOperationAssistantPage.js",
    "src/services/aiOperationAssistantService.js",
  ]) assert.equal(exists(path), false, `${path} should be retired`);
});

test("独立AI经营助手后端API、服务和权限已退出", () => {
  const server = read("server/index.js");
  const permissions = read("shared/permissions.js");

  assert.equal(exists("server/aiOperationAssistantService.js"), false);
  assert.doesNotMatch(server, /\/api\/ai-operation|aiEnterpriseKnowledge|aiEvidence|requireAi(?:View|Analyze|Confirm|Action)/);
  assert.doesNotMatch(permissions, /aiAssistant|aiOperationAssistant|AI经营助手权限/);
});

test("生产Schema退出空AI分析表并对非空历史资产安全降级", () => {
  const schema = read("server/schema.sql");
  const server = read("server/index.js");
  const database = read("server/db.js");

  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS ai_analysis_records/);
  assert.doesNotMatch(schema, /idx_ai_analysis_records_user_status/);
  assert.doesNotMatch(server, /ai_analysis_records/);
  assert.match(database, /SELECT COUNT\(\*\) count FROM ai_analysis_records/);
  assert.match(database, /historicalRecordCount === 0/);
  assert.match(database, /DROP TABLE ai_analysis_records/);
  assert.match(database, /\["supplyChain", "customers", "aiAssistant"\]/);
});

test("产品和链接的独立分析能力继续存在且不依赖退役中心", () => {
  const server = read("server/index.js");
  const productInsight = read("server/productInsightService.js");
  const productReadModel = read("server/productBusinessReadModel.js");
  const connectionService = read("server/connectionService.js");
  const sharedServices = `${productInsight}\n${productReadModel}\n${connectionService}`;

  assert.match(server, /\/api\/product-management\/products\/:id\/user-insights/);
  assert.match(server, /getProductHealthAnalysis/);
  assert.match(server, /getConnectionGrowthAnalysis/);
  assert.match(server, /getConnectionHospital/);
  assert.doesNotMatch(sharedServices, /aiOperationAssistant|aiAssistant|ai_analysis_records/);
});
