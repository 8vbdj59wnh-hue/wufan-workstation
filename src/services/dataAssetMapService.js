import { authFetch } from "../appState.js";

const apiBase = "/api/data-asset-map";

async function readJson(response, message) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || message);
  return payload;
}

function withQuery(path, query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== "" && value !== undefined) params.set(key, value);
  return `${apiBase}${path}${params.size ? `?${params}` : ""}`;
}

export async function loadDataAssetMapOverview() {
  return readJson(await authFetch(`${apiBase}/overview`), "数据资产总览读取失败。");
}

export async function loadDataAssetSources(query) {
  return readJson(await authFetch(withQuery("/sources", query)), "数据源目录读取失败。");
}

export async function loadDataAssetObjects(query) {
  return readJson(await authFetch(withQuery("/objects", query)), "业务对象目录读取失败。");
}

export async function loadDataAssetDetail(kind, id) {
  return readJson(await authFetch(`${apiBase}/${kind}/${encodeURIComponent(id)}`), "数据资产详情读取失败。");
}

export async function loadDataAssetGraph(id) {
  return readJson(await authFetch(`${apiBase}/graphs/${encodeURIComponent(id)}`), "数据关系图读取失败。");
}
