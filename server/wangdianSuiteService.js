import { queryWangdianSuites } from "./wangdianClient.js";

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateTime(value, fieldName) {
  const normalized = text(value);
  if (!normalized) return "";
  const parsed = new Date(normalized.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) throw new Error(`${fieldName}格式无效。`);
  return normalized;
}

export function normalizeWangdianSuiteQuery(raw = {}) {
  const suiteNo = text(raw.suiteNo ?? raw.suite_no);
  const pageNo = Math.max(0, Number(raw.pageNo ?? raw.page_no) || 0);
  const pageSize = Math.min(500, Math.max(1, Number(raw.pageSize ?? raw.page_size) || 100));
  const hideDeleted = [false, 0, "0", "false"].includes(raw.hideDeleted ?? raw.hide_deleted) ? 0 : 1;
  if (suiteNo.length > 80) throw new Error("组合装商家编码不能超过80个字符。");

  const params = { hide_deleted: hideDeleted };
  if (suiteNo) {
    params.suite_no = suiteNo;
    return { params, pageNo, pageSize };
  }

  const startTime = dateTime(raw.startTime ?? raw.start_time, "开始时间");
  const endTime = dateTime(raw.endTime ?? raw.end_time, "结束时间");
  if (!startTime || !endTime) throw new Error("未指定组合装商家编码时，必须提供开始时间和结束时间。");
  const start = new Date(startTime.replace(" ", "T"));
  const end = new Date(endTime.replace(" ", "T"));
  if (end < start) throw new Error("组合装查询结束时间不能早于开始时间。");
  if (end.getTime() - start.getTime() > 30 * 86400000) throw new Error("组合装查询时间跨度不能超过30天。");
  params.start_time = startTime;
  params.end_time = endTime;
  return { params, pageNo, pageSize };
}

function normalizeComponent(row = {}) {
  return {
    wangdianDetailId: text(row.rec_id),
    wangdianSpecId: text(row.spec_id),
    skuCode: text(row.spec_no),
    skuName: text(row.spec_name),
    specificationCode: text(row.spec_code),
    goodsId: text(row.goods_id),
    goodsCode: text(row.goods_no),
    goodsName: text(row.goods_name),
    barcode: text(row.barcode),
    quantity: number(row.num),
    deleted: Number(row.deleted ?? 0) > 0,
    modifiedAt: text(row.modified),
    createdAt: text(row.created),
  };
}

function normalizeSuite(row = {}) {
  const components = Array.isArray(row.detail_list) ? row.detail_list.map(normalizeComponent) : [];
  return {
    wangdianSuiteId: text(row.suite_id),
    suiteCode: text(row.suite_no),
    suiteName: text(row.suite_name),
    shortName: text(row.short_name),
    barcode: text(row.barcode),
    brand: text(row.brand_name),
    category: text(row.class_name),
    unit: text(row.unit_name),
    weight: number(row.weight),
    deleted: Number(row.deleted ?? 0) > 0,
    modifiedAt: text(row.suite_modified),
    createdAt: text(row.suite_created),
    componentCount: components.length,
    components,
  };
}

export async function searchWangdianSuites(rawQuery = {}, { querySuites = queryWangdianSuites } = {}) {
  const query = normalizeWangdianSuiteQuery(rawQuery);
  const payload = await querySuites(query);
  const rows = Array.isArray(payload?.data?.suite_list) ? payload.data.suite_list : [];
  return {
    interfaceMethod: "goods.Suite.search",
    query,
    items: rows.map(normalizeSuite),
    pagination: {
      page: query.pageNo + 1,
      pageSize: query.pageSize,
      total: Number(payload?.data?.total_count ?? rows.length) || 0,
    },
  };
}
