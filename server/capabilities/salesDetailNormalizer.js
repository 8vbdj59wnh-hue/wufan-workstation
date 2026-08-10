export const SALES_DETAIL_FIELD_MAP = Object.freeze({
  店铺: "shop",
  平台货品ID: "platformGoodsId",
  平台规格ID: "platformSkuId",
  商家编码: "merchantSkuCode",
  日期: "saleDate",
  销量: "quantity",
  销售额: "salesAmount",
  成本: "costAmount",
  利润: "profitAmount",
  收入: "incomeAmount",
  退款金额: "refundAmount",
  退货金额: "returnAmount",
  邮费收入: "postageIncomeAmount",
  未知收入成本: "otherAdjustmentAmount",
  货品成本: "goodsCostAmount",
  退货成本: "returnCostAmount",
  邮费成本: "postageCostAmount",
  费用: "feeAmount",
  已收金额: "receivedAmount",
});

const NUMBER_FIELDS = new Set([
  "quantity", "salesAmount", "costAmount", "profitAmount", "incomeAmount", "refundAmount", "returnAmount",
  "postageIncomeAmount", "otherAdjustmentAmount", "goodsCostAmount", "returnCostAmount", "postageCostAmount",
  "feeAmount", "receivedAmount",
]);
const REQUIRED_ATOMIC_FIELDS = Object.freeze([
  ["shop", "店铺"],
  ["platformGoodsId", "平台货品ID"],
  ["platformSkuId", "平台规格ID"],
  ["merchantSkuCode", "商家编码"],
  ["saleDate", "日期"],
]);

const text = (value) => String(value ?? "").trim();
const marker = (value) => text(value).replace(/[\s：:]/g, "").toLowerCase();

function numberValue(value) {
  const raw = text(value).replaceAll(",", "");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = text(value);
  const match = raw.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!match) return "";
  const normalized = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const parsed = new Date(`${normalized}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized ? "" : normalized;
}

function isBlankRow(rawData) {
  return !rawData || !Object.values(rawData).some((value) => text(value));
}

function isSummaryRow(rawData) {
  const shop = marker(rawData?.店铺);
  const goodsId = marker(rawData?.平台货品ID);
  const skuId = marker(rawData?.平台规格ID);
  const merchantSkuCode = marker(rawData?.商家编码);
  const summaryLabel = shop === "合计" || shop === "总计";
  const nonIdentity = [goodsId, skuId, merchantSkuCode].every((value) => !value || value === "na" || value === "n/a" || value === "-");
  return summaryLabel && nonIdentity;
}

export function normalizeSalesDetailLine(rawData = {}, {
  sourceRowNumber = null,
  sourceBatchId = null,
  salesLinkSkuId = null,
  erpSkuId = null,
} = {}) {
  const standard = {
    sourceRowNumber,
    sourceBatchId,
    salesLinkSkuId,
    erpSkuId,
    isAtomicLine: true,
    normalizationStatus: "valid",
    exclusionReasonCode: null,
    shop: text(rawData.店铺),
    platformGoodsId: text(rawData.平台货品ID),
    platformSkuId: text(rawData.平台规格ID),
    merchantSkuCode: text(rawData.商家编码),
    saleDate: dateValue(rawData.日期),
    quantity: numberValue(rawData.销量),
    salesAmount: numberValue(rawData.销售额),
    costAmount: numberValue(rawData.成本),
    profitAmount: numberValue(rawData.利润),
    incomeAmount: numberValue(rawData.收入),
    refundAmount: numberValue(rawData.退款金额),
    returnAmount: numberValue(rawData.退货金额),
    postageIncomeAmount: numberValue(rawData.邮费收入),
    otherAdjustmentAmount: numberValue(rawData.未知收入成本),
    goodsCostAmount: numberValue(rawData.货品成本),
    returnCostAmount: numberValue(rawData.退货成本),
    postageCostAmount: numberValue(rawData.邮费成本),
    feeAmount: numberValue(rawData.费用),
    receivedAmount: numberValue(rawData.已收金额),
    rawData: { ...rawData },
    missingFields: [],
    invalidNumberFields: [],
  };

  if (isBlankRow(rawData)) return {
    ...standard,
    isAtomicLine: false,
    normalizationStatus: "excluded",
    exclusionReasonCode: "EMPTY_LINE",
  };
  if (isSummaryRow(rawData)) return {
    ...standard,
    isAtomicLine: false,
    normalizationStatus: "excluded",
    exclusionReasonCode: "SUMMARY_ROW",
  };

  standard.missingFields = REQUIRED_ATOMIC_FIELDS.filter(([field]) => !text(standard[field])).map(([, label]) => label);
  for (const [header, field] of Object.entries(SALES_DETAIL_FIELD_MAP)) {
    if (!NUMBER_FIELDS.has(field) || !text(rawData[header])) continue;
    if (standard[field] === null) standard.invalidNumberFields.push(header);
  }
  if (standard.missingFields.length || standard.invalidNumberFields.length) {
    standard.normalizationStatus = "incomplete";
  }
  return standard;
}

export default normalizeSalesDetailLine;
