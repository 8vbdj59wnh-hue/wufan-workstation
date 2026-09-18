import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { executeTool, TOOL_DEFINITIONS } from "../plugins/wufan-workstation-readonly/server/index.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const serverPath = path.join(root, "plugins/wufan-workstation-readonly/server/index.mjs");
const settings = Object.freeze({
  baseUrl: new URL("http://127.0.0.1:39001/"),
  token: "test-secret-token",
  timeoutMs: 5_000,
  maxResponseBytes: 1024 * 1024,
});

const representativeArguments = {
  get_goal_center: {},
  get_goal_detail: { goalId: "goal-1" },
  list_key_actions: { page: 1, pageSize: 10, keyword: "增长" },
  list_launchable_action_standards: { page: 1, pageSize: 10, keyword: "增长" },
  preview_key_action_launch: { goalId: "goal-1", taskTemplateId: "standard-1", title: "测试行动", description: "完成测试", dueDate: "2030-09-30", responsiblePersonId: "person-1", customFields: {}, productIds: [] },
  launch_key_action: { goalId: "goal-1", taskTemplateId: "standard-1", title: "测试行动", description: "完成测试", dueDate: "2030-09-30", responsiblePersonId: "person-1", customFields: {}, productIds: [], confirmationToken: "confirmation-token" },
  list_tasks: { view: "today", page: 1, pageSize: 10, showDone: false },
  get_task_detail: { taskId: "task-1" },
  list_work_results: { days: 30 },
  list_products: { page: 1, pageSize: 10, search: "ERP-001" },
  get_product: { identifier: "ERP-001", by: "erpSkuCode" },
  get_product_operating_summary: { days: 30 },
  list_erp_skus: { page: 1, pageSize: 10, search: "ERP-001" },
  list_links: { page: 1, pageSize: 10, keyword: "花瓶", platform: "test" },
  get_link_detail: { linkId: "link-1", detail: "core" },
  get_link_daily_sales: { linkId: "link-1", startDate: "2026-09-01", endDate: "2026-09-08" },
  list_link_business: { page: 1, pageSize: 10, range: "30d" },
  get_link_data_status: {},
  get_data_sync_status: { batchLimit: 5, exceptionLimit: 10 },
  get_anomaly_summary: {},
  get_operation_dashboard: {},
  get_sales_business_dashboard: { range: "30d", page: 1, pageSize: 10 },
  get_notifications_summary: { limit: 10 },
  get_content_product_selection: { brand: "南屿" },
  list_content_column_schedule: { startDate: "2026-09-21", endDate: "2026-09-27", page: 1, pageSize: 50, column: "产品笔记" },
  revise_request_topics:{idempotencyKey:"topics-20-notes",items:[{id:"request-1",revision:2,hashtags:"#花瓶 #美物"}]},
  revise_request_copy:{idempotencyKey:"copy-v2-20-notes",items:[{id:"request-1",revision:2,title:"新标题",copyText:"新正文"}]},
  save_request_plans:{idempotencyKey:"plan-week-v1",items:[{id:"request-1",revision:2,title:"标题",copyText:"正文",hashtags:"",imageScript:"封面",materialNeeds:"素材"}]},
  expand_next_week_requests: {idempotencyKey:"expand-week-2026-v1",items:[{id:"request-1",revision:1,notes:"扩写需求",workstationProductIds:["sku-1"]}]},
  fill_next_week_requests: {idempotencyKey:"fill-week-2026-v1",items:[{id:"request-1",revision:1,notes:"补填需求",workstationProductIds:["sku-1"],noteFormat:"图文"}]},
  save_next_week_requests: {
    idempotencyKey: "nanyu-2026-w39-v1",
    items: [{ accountId: "account-1", column: "产品笔记", workstationProductIds: ["sku-1"], noteFormat: "图文", preferredDate: "2026-09-22", preferredTime: "10:30", notes: "围绕已确认产品策划一篇种草笔记。" }],
  },
};

test("插件只暴露固定查询与受控发起工具并提供准确安全标注", () => {
  assert.equal(TOOL_DEFINITIONS.length, Object.keys(representativeArguments).length);
  assert.deepEqual(new Set(TOOL_DEFINITIONS.map((item) => item.name)), new Set(Object.keys(representativeArguments)));
  for (const definition of TOOL_DEFINITIONS) {
    assert.equal(definition.annotations.readOnlyHint, !new Set(["launch_key_action", "save_next_week_requests", "fill_next_week_requests", "expand_next_week_requests", "save_request_plans", "revise_request_copy", "revise_request_topics"]).has(definition.name), definition.name);
    assert.equal(definition.annotations.destructiveHint, false, definition.name);
    assert.equal(definition.annotations.openWorldHint, false, definition.name);
    assert.equal(definition.inputSchema.additionalProperties, false, definition.name);
    if (!new Set(["launch_key_action", "save_next_week_requests", "fill_next_week_requests", "expand_next_week_requests", "save_request_plans", "revise_request_copy", "revise_request_topics"]).has(definition.name)) assert.doesNotMatch(definition.name, /create|update|delete|write|import|sync_run|approve|execute/u);
  }
});

test("工具只访问固定正式API，且仅受控预览、确认与新增下周需求使用POST", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: new URL(url), options });
    return new Response(JSON.stringify({ success: true, path: new URL(url).pathname }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  for (const [name, args] of Object.entries(representativeArguments)) {
    const result = await executeTool(name, args, { settings, fetchImpl });
    assert.equal(result.success, true, name);
  }

  assert.equal(requests.length, TOOL_DEFINITIONS.length);
  for (const request of requests) {
    const expectedMethod = new Set(["/api/key-actions/launch-preview", "/api/key-actions/launch", "/api/content-center/planning/requests", "/api/content-center/planning/requests/expand", "/api/content-center/planning/requests/fill", "/api/content-center/planning/requests/plans", "/api/content-center/planning/requests/revise-copy", "/api/content-center/planning/requests/revise-topics"]).has(request.url.pathname) ? "POST" : "GET";
    assert.equal(request.options.method, expectedMethod);
    assert.equal(request.options.headers.Authorization, "Bearer test-secret-token");
    assert.equal(request.options.redirect, "error");
    assert.equal(request.url.origin, "http://127.0.0.1:39001");
    assert.match(request.url.pathname, /^\/api\//u);
  }
  assert.deepEqual(requests.filter((item) => item.options.method === "POST").map((item) => item.url.pathname), [
    "/api/key-actions/launch-preview",
    "/api/key-actions/launch",
    "/api/content-center/planning/requests/revise-topics", "/api/content-center/planning/requests/revise-copy",
    "/api/content-center/planning/requests/plans",
    "/api/content-center/planning/requests/expand", "/api/content-center/planning/requests/fill",
    "/api/content-center/planning/requests",
  ]);
});

test("内容策划工具限制日期、分页和下周需求载荷", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: new URL(url), options });
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
  await executeTool("list_content_column_schedule", { startDate: "2026-09-21", endDate: "2026-09-27", pageSize: 999 }, { settings, fetchImpl });
  await executeTool("save_next_week_requests", representativeArguments.save_next_week_requests, { settings, fetchImpl });
  assert.equal(requests[0].url.searchParams.get("pageSize"), "100");
  assert.deepEqual(JSON.parse(requests[1].options.body), representativeArguments.save_next_week_requests);
  await assert.rejects(
    executeTool("save_next_week_requests", { idempotencyKey: "short", items: [] }, { settings, fetchImpl }),
    /1至100条/u,
  );
  await assert.rejects(
    executeTool("save_next_week_requests", { ...representativeArguments.save_next_week_requests, items: [{ ...representativeArguments.save_next_week_requests.items[0], preferredTime: "25:00" }] }, { settings, fetchImpl }),
    /HH:mm/u,
  );
});

test("短期JWT到期后只调用固定认证接口续期并安全保存新JWT", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wufan-plugin-refresh-"));
  const tokenFile = path.join(directory, "token.jwt");
  const expiredToken = [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url"),
    "signature",
  ].join(".");
  const requests = [];
  const refreshSettings = {
    ...settings,
    token: expiredToken,
    tokenFile,
    refreshToken: "wfr1.test-refresh-token",
  };
  const fetchImpl = async (url, options) => {
    requests.push({ url: new URL(url), options });
    if (new URL(url).pathname === "/api/auth/device-sessions/refresh") {
      return new Response(JSON.stringify({ success: true, token: "renewed-access-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } });
  };

  await executeTool("get_goal_center", {}, { settings: refreshSettings, fetchImpl });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url.pathname, "/api/auth/device-sessions/refresh");
  assert.equal(requests[0].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].options.body), { refreshToken: "wfr1.test-refresh-token" });
  assert.equal(requests[1].options.method, "GET");
  assert.equal(requests[1].options.headers.Authorization, "Bearer renewed-access-token");
  assert.equal(fs.readFileSync(tokenFile, "utf8"), "renewed-access-token");
});

test("分页上限、路径编码和任务筛选由适配器收口", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(new URL(url));
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
  await executeTool("list_products", { page: -8, pageSize: 9999, search: "花瓶" }, { settings, fetchImpl });
  await executeTool("get_link_detail", { linkId: "../private/file", detail: "core" }, { settings, fetchImpl });
  await executeTool("list_tasks", { view: "today", status: "doing", showDone: true }, { settings, fetchImpl });

  assert.equal(urls[0].searchParams.get("page"), "1");
  assert.equal(urls[0].searchParams.get("pageSize"), "100");
  assert.match(urls[1].pathname, /\.\.%2Fprivate%2Ffile\/core-detail$/u);
  assert.deepEqual(JSON.parse(urls[2].searchParams.get("filters")), { status: "doing", showDone: true });
});

test("超大响应会被拒绝且上游错误不会泄露JWT", async () => {
  await assert.rejects(
    executeTool("get_goal_center", {}, {
      settings: { ...settings, maxResponseBytes: 64 },
      fetchImpl: async () => new Response("x".repeat(256), { status: 200, headers: { "content-length": "256" } }),
    }),
    /超过64字节安全上限/u,
  );

  await assert.rejects(
    executeTool("get_goal_center", {}, {
      settings,
      fetchImpl: async () => new Response(JSON.stringify({ message: `拒绝访问 ${settings.token}` }), { status: 403 }),
    }),
    (error) => {
      assert.doesNotMatch(error.message, /test-secret-token/u);
      assert.match(error.message, /\[REDACTED\]/u);
      return true;
    },
  );
});

test("STDIO MCP初始化、工具枚举和未知方法符合JSON-RPC边界", async () => {
  const child = spawn(process.execPath, [serverPath], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  const messages = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "unsafe/write", params: {} },
  ];
  child.stdin.write(messages.map((message) => JSON.stringify(message)).join("\n") + "\n");

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`MCP响应超时：${stdout}\n${stderr}`)), 5_000);
    const poll = setInterval(() => {
      if (stdout.trim().split("\n").length >= 3) {
        clearInterval(poll);
        clearTimeout(timeout);
        resolve();
      }
    }, 10);
  });
  child.kill("SIGTERM");
  const responses = stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(responses.length, 3);
  assert.equal(responses[0].result.serverInfo.name, "wufan-workstation-assistant");
  assert.equal(responses[1].result.tools.length, TOOL_DEFINITIONS.length);
  assert.equal(responses[2].error.code, -32601);
  assert.equal(stderr, "");
});

test('需求扩写工具字段收口，以及空正文能力不退化',async()=>{
 const requests=[];const fetchImpl=async(url,options)=>{requests.push(JSON.parse(options.body));return new Response('{}',{status:200,headers:{'content-type':'application/json'}});};
 const row={id:'n1',revision:1,notes:'原栏目提示扩写',workstationProductIds:['p1']};
 for(const extra of [{preferredTime:'12:30'},{notes:null},{workstationProductIds:null},{workstationProductIds:[42]}])await assert.rejects(()=>executeTool('expand_next_week_requests',{idempotencyKey:'expand-mcp-test',items:[{...row,...extra}]},{settings,fetchImpl}));
 assert.equal(requests.length,0);
 await executeTool('expand_next_week_requests',{idempotencyKey:'expand-mcp-test',items:[row]},{settings,fetchImpl});assert.deepEqual(requests[0].items[0],row);
 for(const name of ['save_request_plans','revise_request_copy']){
  await executeTool(name,{idempotencyKey:'empty-mcp-test',items:[{id:'n1',revision:1,title:'标题',copyText:''}]},{settings,fetchImpl});assert.equal(requests.at(-1).items[0].copyText,'');
  for(const copyText of [undefined,null,4,' \n '])await assert.rejects(()=>executeTool(name,{idempotencyKey:'empty-mcp-test',items:[{id:'n1',revision:1,title:'标题',copyText}]},{settings,fetchImpl}));
 }
});
