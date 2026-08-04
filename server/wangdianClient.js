import crypto from "node:crypto";

const WDT_EPOCH_SECONDS = 1325347200;
const DEFAULT_METHOD = "goods.Goods.queryWithSpec";
const DEFAULT_VERSION = "1.0";

function value(raw) {
  return String(raw ?? "").trim();
}

export function splitWangdianCredential(rawCredential) {
  const credential = value(rawCredential);
  const separator = credential.indexOf(":");
  if (separator <= 0 || separator === credential.length - 1) {
    throw new Error("WDT_SALT 必须使用旺店通 appsecret 的 secret:salt 完整格式。");
  }
  return { secret: credential.slice(0, separator), salt: credential.slice(separator + 1) };
}

export function createWangdianTimestamp(now = Date.now()) {
  return Math.floor(now / 1000) - WDT_EPOCH_SECONDS;
}

export function signWangdianRequest(parameters, secret) {
  const sorted = Object.entries(parameters)
    .filter(([key]) => key !== "sign")
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const middle = sorted.map(([key, item]) => `${key}${String(item)}`).join("");
  return crypto.createHash("md5").update(`${secret}${middle}${secret}`, "utf8").digest("hex");
}

export function readWangdianConfig(environment = process.env) {
  const apiUrl = value(environment.WDT_API_URL);
  const sid = value(environment.WDT_SID);
  const key = value(environment.WDT_KEY);
  const credential = value(environment.WDT_SALT);
  if (!apiUrl || !sid || !key || !credential) {
    throw new Error("旺店通连接未配置，请设置 WDT_API_URL、WDT_SID、WDT_KEY、WDT_SALT。");
  }
  if (!/^https?:\/\//u.test(apiUrl)) throw new Error("WDT_API_URL 必须是 HTTP 或 HTTPS 地址。");
  const { secret, salt } = splitWangdianCredential(credential);
  return { apiUrl, sid, key, secret, salt };
}

export function hasWangdianConfig(environment = process.env) {
  try {
    readWangdianConfig(environment);
    return true;
  } catch {
    return false;
  }
}

export async function callWangdianApi({
  method = DEFAULT_METHOD,
  body,
  pageNo = 0,
  pageSize = 100,
  calcTotal = pageNo === 0 ? 1 : 0,
  config = readWangdianConfig(),
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  timeoutMs = 30_000,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("当前运行环境不支持旺店通HTTP请求。");
  const safePageNo = Math.max(0, Number(pageNo) || 0);
  const safePageSize = Math.min(500, Math.max(1, Number(pageSize) || 100));
  const requestBody = JSON.stringify(Array.isArray(body) ? body : [body ?? {}]);
  const publicParameters = {
    key: config.key,
    method,
    salt: config.salt,
    sid: config.sid,
    timestamp: createWangdianTimestamp(now),
    v: DEFAULT_VERSION,
    page_no: safePageNo,
    page_size: safePageSize,
    calc_total: calcTotal ? 1 : 0,
  };
  const sign = signWangdianRequest({ ...publicParameters, body: requestBody }, config.secret);
  const url = new URL(config.apiUrl);
  for (const [key, item] of Object.entries({ ...publicParameters, sign })) url.searchParams.set(key, String(item));
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`旺店通接口连接失败：${error.name === "TimeoutError" ? "请求超时" : "网络不可用或地址不可达"}`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`旺店通接口返回非JSON响应（HTTP ${response.status}）。`);
  }
  if (!response.ok) throw new Error(`旺店通接口HTTP ${response.status}。`);
  if (Number(payload?.status) !== 0) {
    throw new Error(`旺店通接口失败（${payload?.status ?? "未知状态"}）：${value(payload?.message) || "未知错误"}`);
  }
  return payload;
}

export async function queryWangdianGoods({ params = {}, pageNo = 0, pageSize = 100, ...options } = {}) {
  return callWangdianApi({
    ...options,
    method: DEFAULT_METHOD,
    body: params,
    pageNo,
    pageSize,
    calcTotal: pageNo === 0 ? 1 : 0,
  });
}

export async function queryWangdianPlatformGoods({ params = {}, pageNo = 0, pageSize = 100, ...options } = {}) {
  return callWangdianApi({
    ...options,
    method: "goods.ApiGoods.search",
    body: params,
    pageNo,
    pageSize,
    calcTotal: pageNo === 0 ? 1 : 0,
  });
}

export async function queryWangdianInventory({ params = {}, pageNo = 0, pageSize = 500, ...options } = {}) {
  return callWangdianApi({
    ...options,
    method: "wms.StockSpec.search2",
    body: { ...params, mask: params.mask ?? 3 },
    pageNo,
    pageSize,
    calcTotal: pageNo === 0 ? 1 : 0,
  });
}
