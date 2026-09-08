#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_NAME = "wufan-workstation-readonly";
const SERVER_VERSION = "1.0.0";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_PAGE_SIZE = 100;

const objectSchema = (properties = {}, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const textProperty = (description, maxLength = 200) => ({ type: "string", description, maxLength });
const pageProperties = {
  page: { type: "integer", minimum: 1, default: 1 },
  pageSize: { type: "integer", minimum: 1, maximum: MAX_PAGE_SIZE, default: 20 },
};
const readAnnotations = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
});

function tool(name, title, description, inputSchema, request) {
  return Object.freeze({
    definition: Object.freeze({ name, title, description, inputSchema, annotations: readAnnotations }),
    request,
  });
}

function clampInteger(value, fallback, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function cleanText(value, name, { required = false, maxLength = 200 } = {}) {
  const text = String(value ?? "").trim();
  if (required && text === "") throw new Error(`${name}不能为空。`);
  if (text.length > maxLength) throw new Error(`${name}不能超过${maxLength}个字符。`);
  return text;
}

function cleanEnum(value, name, allowed, fallback = "") {
  const text = cleanText(value, name, { maxLength: 50 });
  if (text === "") return fallback;
  if (!allowed.includes(text)) throw new Error(`${name}不在允许范围内。`);
  return text;
}

function cleanDate(value, name) {
  const text = cleanText(value, name, { maxLength: 10 });
  if (text === "") return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new Error(`${name}必须使用YYYY-MM-DD格式。`);
  }
  return text;
}

function queryPath(pathname, values = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, typeof value === "boolean" ? String(value) : String(value));
  }
  const suffix = query.toString();
  return suffix === "" ? pathname : `${pathname}?${suffix}`;
}

function pageArgs(args = {}, fallbackSize = 20) {
  return {
    page: clampInteger(args.page, 1),
    pageSize: clampInteger(args.pageSize, fallbackSize, 1, MAX_PAGE_SIZE),
  };
}

function taskFilters(args = {}) {
  const filters = {};
  for (const key of ["status", "source", "departmentId", "ownerId", "executorId", "overdue"]) {
    const value = cleanText(args[key], key, { maxLength: 100 });
    if (value !== "") filters[key] = value;
  }
  for (const key of ["showDone", "showCanceled", "showImprovementTasks"]) {
    if (typeof args[key] === "boolean") filters[key] = args[key];
  }
  return Object.keys(filters).length === 0 ? "" : JSON.stringify(filters);
}

const TOOL_SPECS = [
  tool("get_goal_center", "读取目标中心", "读取当前账号数据范围内的目标中心正式数据。", objectSchema(), () => ({ path: "/api/goal-center/bootstrap" })),
  tool("get_goal_detail", "读取目标详情", "按目标ID读取正式目标详情。", objectSchema({ goalId: textProperty("目标ID", 100) }, ["goalId"]), (args) => ({ path: `/api/goal-center/goals/${encodeURIComponent(cleanText(args.goalId, "goalId", { required: true, maxLength: 100 }))}/detail` })),
  tool("list_key_actions", "查询关键行动", "分页、搜索当前账号可见的关键行动。", objectSchema({ ...pageProperties, keyword: textProperty("关键字", 200) }), (args) => ({ path: queryPath("/api/schedule-board/page", { ...pageArgs(args), keyword: cleanText(args.keyword, "keyword") }) })),
  tool("list_tasks", "查询任务", "分页查询今天、我的、逾期或全部任务。", objectSchema({
    ...pageProperties,
    view: { type: "string", enum: ["today", "mine", "overdue", "all"], default: "today" },
    keyword: textProperty("任务名称、任务编码、行动编码或模板编码", 200),
    sort: { type: "string", enum: ["remaining", "name"], default: "remaining" },
    status: textProperty("任务状态", 50), source: textProperty("任务来源", 50),
    departmentId: textProperty("部门ID", 100), ownerId: textProperty("负责人ID", 100), executorId: textProperty("执行人ID", 100),
    overdue: { type: "string", enum: ["yes", "no"] }, showDone: { type: "boolean" }, showCanceled: { type: "boolean" }, showImprovementTasks: { type: "boolean" },
  }), (args) => ({ path: queryPath("/api/task-center/tasks", {
    ...pageArgs(args, 50), view: cleanEnum(args.view, "view", ["today", "mine", "overdue", "all"], "today"),
    keyword: cleanText(args.keyword, "keyword"), sort: cleanEnum(args.sort, "sort", ["remaining", "name"], "remaining"), filters: taskFilters(args),
  }) })),
  tool("get_task_detail", "读取任务详情", "按任务ID读取任务及其正式上下文。", objectSchema({ taskId: textProperty("任务ID", 100) }, ["taskId"]), (args) => ({ path: `/api/task-center/tasks/${encodeURIComponent(cleanText(args.taskId, "taskId", { required: true, maxLength: 100 }))}/detail` })),
  tool("list_work_results", "读取工作结果", "读取最近一段时间内当前账号可见的工作结果。", objectSchema({ days: { type: "integer", minimum: 1, maximum: 366, default: 30 } }), (args) => ({ path: queryPath("/api/work-results/initial", { days: clampInteger(args.days, 30, 1, 366) }) })),
  tool("list_products", "查询产品", "使用服务端分页和正式搜索字段查询产品，不加载全部产品数据。", objectSchema({
    ...pageProperties, search: textProperty("产品ID、ERP SKU编码、产品编码或名称", 200),
    status: textProperty("产品状态", 50), lifecycleStatus: textProperty("生命周期状态", 50), sort: textProperty("正式排序字段", 50),
  }), (args) => ({ path: queryPath("/api/product-center-v2/products", {
    ...pageArgs(args, 30), search: cleanText(args.search, "search"), status: cleanText(args.status, "status", { maxLength: 50 }),
    lifecycleStatus: cleanText(args.lifecycleStatus, "lifecycleStatus", { maxLength: 50 }), sort: cleanText(args.sort, "sort", { maxLength: 50 }),
  }) })),
  tool("get_product", "读取单个产品", "通过Product ID、ERP SKU编码或产品编码精确查询单个产品。", objectSchema({
    identifier: textProperty("精确标识", 200),
    by: { type: "string", enum: ["auto", "productId", "erpSkuCode", "productCode"], default: "auto" },
  }, ["identifier"]), (args) => ({ path: queryPath(`/api/product-center-v2/products/${encodeURIComponent(cleanText(args.identifier, "identifier", { required: true, maxLength: 200 }))}`, { by: cleanEnum(args.by, "by", ["auto", "productId", "erpSkuCode", "productCode"], "auto") }) })),
  tool("get_product_operating_summary", "读取产品经营摘要", "只读取产品汇报所需的正式聚合指标。", objectSchema({ days: { type: "integer", minimum: 1, maximum: 366, default: 30 } }), (args) => ({ path: queryPath("/api/product-center-v2/products/operating-summary", { days: clampInteger(args.days, 30, 1, 366) }) })),
  tool("list_erp_skus", "查询ERP SKU", "分页查询当前正式ERP SKU数据。", objectSchema({ ...pageProperties, search: textProperty("ERP SKU编码或名称", 200), status: textProperty("状态", 50) }), (args) => ({ path: queryPath("/api/product-center-v2/skus", { ...pageArgs(args), search: cleanText(args.search, "search"), status: cleanText(args.status, "status", { maxLength: 50 }) }) })),
  tool("list_links", "查询Link", "在正式权限和数据范围内分页、搜索、筛选Link明细。", objectSchema({
    ...pageProperties, keyword: textProperty("Link标题、编码或商品ID", 200), platform: textProperty("平台", 50),
    status: textProperty("状态", 50), shopId: textProperty("店铺ID", 100),
  }), (args) => ({ path: queryPath("/api/connections", {
    ...pageArgs(args), keyword: cleanText(args.keyword, "keyword"), platform: cleanText(args.platform, "platform", { maxLength: 50 }),
    status: cleanText(args.status, "status", { maxLength: 50 }), shopId: cleanText(args.shopId, "shopId", { maxLength: 100 }),
  }) })),
  tool("get_link_detail", "读取Link详情", "按Link ID读取正式经营详情或连接档案。", objectSchema({
    linkId: textProperty("Link ID", 100), detail: { type: "string", enum: ["core", "record"], default: "core" },
  }, ["linkId"]), (args) => {
    const id = encodeURIComponent(cleanText(args.linkId, "linkId", { required: true, maxLength: 100 }));
    const detail = cleanEnum(args.detail, "detail", ["core", "record"], "core");
    return { path: detail === "record" ? `/api/connections/${id}` : `/api/connections/${id}/core-detail` };
  }),
  tool("get_link_daily_sales", "读取Link经营数据", "读取一个Link在指定日期范围内的正式销售、成本和利润数据。", objectSchema({
    linkId: textProperty("Link ID", 100), startDate: textProperty("开始日期YYYY-MM-DD", 10), endDate: textProperty("结束日期YYYY-MM-DD", 10),
  }, ["linkId"]), (args) => ({ path: queryPath(`/api/connections/${encodeURIComponent(cleanText(args.linkId, "linkId", { required: true, maxLength: 100 }))}/daily-sales`, { startDate: cleanDate(args.startDate, "startDate"), endDate: cleanDate(args.endDate, "endDate") }) })),
  tool("list_link_business", "查询Link经营分析", "分页读取公司范围内正式Link经营分析。", objectSchema({
    ...pageProperties, keyword: textProperty("关键字", 200), range: textProperty("正式时间范围", 50), shopId: textProperty("店铺ID", 100),
  }), (args) => ({ path: queryPath("/api/link-business-table", { scope: "company", ...pageArgs(args), keyword: cleanText(args.keyword, "keyword"), range: cleanText(args.range, "range", { maxLength: 50 }), shopId: cleanText(args.shopId, "shopId", { maxLength: 100 }) }) })),
  tool("get_link_data_status", "读取Link数据状态", "读取正式Link数据更新时间和状态。", objectSchema({ shopId: textProperty("店铺ID", 100) }), (args) => ({ path: queryPath("/api/link-data-status", { shopId: cleanText(args.shopId, "shopId", { maxLength: 100 }) }) })),
  tool("get_data_sync_status", "读取数据中心状态", "纯只读获取最近同步状态、时间、结果和异常摘要，不触发同步。", objectSchema({ batchLimit: { type: "integer", minimum: 1, maximum: 50, default: 10 }, exceptionLimit: { type: "integer", minimum: 1, maximum: 100, default: 20 } }), (args) => ({ path: queryPath("/api/data-sync-center", { batchLimit: clampInteger(args.batchLimit, 10, 1, 50), exceptionLimit: clampInteger(args.exceptionLimit, 20, 1, 100) }) })),
  tool("get_anomaly_summary", "读取异常摘要", "读取异常记录数、去重业务对象、正常无需关系、主数据待完善、真实关系冲突和Legacy历史资产的正式分类事实。", objectSchema(), () => ({ path: "/api/data-sync-center/anomaly-summary" })),
  tool("get_operation_dashboard", "读取经营驾驶舱", "读取经营简报所需的正式驾驶舱汇总数据。", objectSchema(), () => ({ path: "/api/operation-dashboard" })),
  tool("get_sales_business_dashboard", "读取销售经营驾驶舱", "分页读取正式销售经营汇总。", objectSchema({ ...pageProperties, range: textProperty("时间范围，例如30d", 50), keyword: textProperty("关键字", 200) }), (args) => ({ path: queryPath("/api/sales-business-dashboard", { ...pageArgs(args), range: cleanText(args.range, "range", { maxLength: 50 }) || "30d", keyword: cleanText(args.keyword, "keyword") }) })),
  tool("get_notifications_summary", "读取通知摘要", "只读获取当前账号通知摘要，不改变已读状态。", objectSchema({ limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } }), (args) => ({ path: queryPath("/api/notifications/summary", { limit: clampInteger(args.limit, 20, 1, 100) }) })),
];

const TOOL_BY_NAME = new Map(TOOL_SPECS.map((item) => [item.definition.name, item]));
export const TOOL_DEFINITIONS = Object.freeze(TOOL_SPECS.map((item) => item.definition));

function readOptionalJson(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("配置必须是JSON对象。");
    return value;
  } catch (error) {
    throw new Error(`无法读取工作站配置：${error.message}`);
  }
}

function configDirectory() {
  return process.env.WUFAN_WORKSTATION_CONFIG_DIR
    ? path.resolve(process.env.WUFAN_WORKSTATION_CONFIG_DIR)
    : path.join(os.homedir(), ".codex", "wufan-workstation");
}

function normalizeBaseUrl(value) {
  const source = cleanText(value, "baseUrl", { required: true, maxLength: 2048 });
  const parsed = new URL(source);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("工作站地址只允许HTTP或HTTPS。 ");
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("工作站地址不能包含凭据、查询参数或片段。");
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") + "/";
  return parsed;
}

export function loadSettings() {
  const directory = configDirectory();
  const config = readOptionalJson(path.join(directory, "config.json"));
  const baseUrl = normalizeBaseUrl(process.env.WUFAN_WORKSTATION_BASE_URL || config.baseUrl);
  const tokenFile = process.env.WUFAN_WORKSTATION_TOKEN_FILE
    ? path.resolve(process.env.WUFAN_WORKSTATION_TOKEN_FILE)
    : path.resolve(directory, config.tokenFile || "token.jwt");
  const refreshTokenFile = process.env.WUFAN_WORKSTATION_REFRESH_TOKEN_FILE
    ? path.resolve(process.env.WUFAN_WORKSTATION_REFRESH_TOKEN_FILE)
    : path.resolve(directory, config.refreshTokenFile || "refresh.token");
  const token = cleanText(process.env.WUFAN_WORKSTATION_TOKEN || (fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, "utf8") : ""), "JWT", { maxLength: 16_384 });
  const refreshToken = cleanText(fs.existsSync(refreshTokenFile) ? fs.readFileSync(refreshTokenFile, "utf8") : "", "设备续期凭证", { maxLength: 16_384 });
  if (!token && !refreshToken) throw new Error("缺少工作站访问凭证，请重新运行安装脚本授权这台设备。");
  return {
    baseUrl,
    token,
    tokenFile,
    refreshToken,
    refreshTokenFile,
    timeoutMs: clampInteger(config.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 120_000),
    maxResponseBytes: clampInteger(config.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, 64 * 1024, 32 * 1024 * 1024),
  };
}

function redact(text, secrets = []) {
  let value = String(text ?? "");
  for (const secret of secrets) {
    if (secret) value = value.split(secret).join("[REDACTED]");
  }
  return value.slice(0, 1_000);
}

async function readLimitedBody(response, maximumBytes) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maximumBytes) throw new Error(`工作站响应超过${maximumBytes}字节安全上限。`);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error(`工作站响应超过${maximumBytes}字节安全上限。`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function tokenExpiresSoon(token, marginMs = 5 * 60 * 1000) {
  if (!token) return true;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const expiry = Number(payload.exp);
    if (!Number.isFinite(expiry)) return true;
    const expiryMs = expiry < 1_000_000_000_000 ? expiry * 1000 : expiry;
    return expiryMs <= Date.now() + marginMs;
  } catch {
    return true;
  }
}

function saveAccessToken(settings, token) {
  fs.mkdirSync(path.dirname(settings.tokenFile), { recursive: true });
  fs.writeFileSync(settings.tokenFile, token, { encoding: "utf8", mode: 0o600 });
  try { fs.chmodSync(settings.tokenFile, 0o600); } catch {}
  settings.token = token;
}

let activeRefresh = null;
async function refreshAccessToken(settings, fetchImpl) {
  if (!settings.refreshToken) throw new Error("短期JWT已失效，且本机没有设备续期凭证，请重新运行安装脚本。");
  if (activeRefresh) return activeRefresh;
  activeRefresh = (async () => {
    const url = new URL("api/auth/device-sessions/refresh", settings.baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: settings.refreshToken }),
        redirect: "error",
        signal: controller.signal,
      });
      const raw = await readLimitedBody(response, Math.min(settings.maxResponseBytes, 1024 * 1024));
      let payload = {};
      try { payload = raw ? JSON.parse(raw) : {}; }
      catch { throw new Error(`工作站续期接口返回了无效JSON（HTTP ${response.status}）。`); }
      if (!response.ok || typeof payload?.token !== "string" || !payload.token) {
        throw new Error(payload?.message || `工作站设备续期失败（HTTP ${response.status}）。`);
      }
      saveAccessToken(settings, payload.token);
      return payload.token;
    } finally {
      clearTimeout(timer);
      activeRefresh = null;
    }
  })();
  return activeRefresh;
}

async function requestRead(url, settings, token, fetchImpl, signal) {
  return fetchImpl(url, {
    method: "GET",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    redirect: "error",
    signal,
  });
}

export async function executeTool(name, args = {}, options = {}) {
  const spec = TOOL_BY_NAME.get(name);
  if (!spec) throw new Error(`未知只读工具：${cleanText(name, "name", { maxLength: 100 })}`);
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("工具参数必须是对象。");
  const request = spec.request(args);
  if (!request || typeof request.path !== "string" || !request.path.startsWith("/api/")) throw new Error("内部只读路由配置无效。");
  const settings = options.settings || loadSettings();
  const url = new URL(request.path.replace(/^\/+/, ""), settings.baseUrl);
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
  try {
    let token = settings.token;
    if (settings.refreshToken && tokenExpiresSoon(token)) token = await refreshAccessToken(settings, fetchImpl);
    let response = await requestRead(url, settings, token, fetchImpl, controller.signal);
    if (response.status === 401 && settings.refreshToken) {
      try { await response.body?.cancel(); } catch {}
      token = await refreshAccessToken(settings, fetchImpl);
      response = await requestRead(url, settings, token, fetchImpl, controller.signal);
    }
    const raw = await readLimitedBody(response, settings.maxResponseBytes);
    let payload = {};
    if (raw !== "") {
      try { payload = JSON.parse(raw); }
      catch { throw new Error(`工作站返回了无效JSON（HTTP ${response.status}）。`); }
    }
    if (!response.ok) {
      const message = payload?.message || payload?.error || `工作站请求失败（HTTP ${response.status}）。`;
      throw new Error(redact(message, [token, settings.refreshToken]));
    }
    if (!payload || typeof payload !== "object") return { value: payload };
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("工作站只读请求超时。");
    throw new Error(redact(error?.message || error, [settings.token, settings.refreshToken]));
  } finally {
    clearTimeout(timer);
  }
}

function toolResult(name, payload) {
  return {
    content: [{ type: "text", text: `${name}读取成功。` }],
    structuredContent: payload,
  };
}

function errorToolResult(error) {
  return { isError: true, content: [{ type: "text", text: error?.message || "工作站只读查询失败。" }] };
}

async function handleRequest(message) {
  const method = message?.method;
  if (method === "initialize") {
    return {
      protocolVersion: String(message.params?.protocolVersion || "2025-06-18"),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions: "极简工作站正式只读数据源。只能调用本服务器列出的查询工具；不得尝试写入、同步、审批、导入、删除、权限管理、数据库或服务器文件访问。列表先分页再按ID读取详情。异常分类必须保持正式口径：not_applicable是正常无需关系，masterDataIncomplete是当前主数据待完善，relationConflict才是真实关系冲突，legacyAssets是历史资产。",
    };
  }
  if (method === "ping") return {};
  if (method === "tools/list") return { tools: TOOL_DEFINITIONS };
  if (method === "tools/call") {
    try {
      const name = cleanText(message.params?.name, "工具名称", { required: true, maxLength: 100 });
      return toolResult(name, await executeTool(name, message.params?.arguments || {}));
    } catch (error) {
      return errorToolResult(error);
    }
  }
  throw Object.assign(new Error(`不支持的MCP方法：${method || "空"}`), { code: -32601 });
}

function writeMessage(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export function startStdioServer() {
  process.stdin.setEncoding("utf8");
  let buffer = "";
  let chain = Promise.resolve();
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const newline = buffer.indexOf("\n");
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      chain = chain.then(async () => {
        let message;
        try { message = JSON.parse(line); }
        catch {
          writeMessage({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON解析失败。" } });
          return;
        }
        if (message.id === undefined || message.id === null) return;
        try {
          writeMessage({ jsonrpc: "2.0", id: message.id, result: await handleRequest(message) });
        } catch (error) {
          writeMessage({ jsonrpc: "2.0", id: message.id, error: { code: error.code || -32603, message: error.message || "MCP服务器错误。" } });
        }
      });
    }
  });
  process.stdin.resume();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) startStdioServer();
