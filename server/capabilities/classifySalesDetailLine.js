const CAPABILITY = "ClassifySalesDetailLine";
const CONTRACT_VERSION = "1.0";
const CLASSIFICATIONS = new Set([
  "product_sale",
  "accounting_auxiliary",
  "shipping_adjustment",
  "other_adjustment",
]);

const USAGE_CLASSIFICATION = Object.freeze({
  product: "product_sale",
  accounting_auxiliary: "accounting_auxiliary",
  shipping_adjustment: "shipping_adjustment",
  other_adjustment: "other_adjustment",
});

function output(classification, overrides = {}) {
  const product = classification === "product_sale";
  const unknown = classification === "unknown";
  return {
    capability: CAPABILITY,
    contractVersion: CONTRACT_VERSION,
    classification,
    isProductRelation: unknown ? null : product,
    relationRequired: product,
    // Product classification alone never authorizes a fact write. A complete
    // formal relation is still required downstream.
    isFactEligible: false,
    requiresManualReview: unknown,
    reasonCodes: [],
    evidence: {},
    warnings: [],
    ...overrides,
  };
}

function normalizedEvidence(line) {
  return {
    sourceRowNumber: line?.sourceRowNumber ?? null,
    merchantSkuCode: line?.merchantSkuCode || null,
    erpSkuId: line?.erpSkuId || null,
    salesLinkSkuId: line?.salesLinkSkuId || null,
    normalizationStatus: line?.normalizationStatus || null,
  };
}

export function classifySalesDetailLine(line = {}, context = {}) {
  const evidence = normalizedEvidence(line);
  if (line.isAtomicLine === false && line.normalizationStatus === "excluded") return output("excluded", {
    isFactEligible: false,
    reasonCodes: [line.exclusionReasonCode || "NON_ATOMIC_LINE"],
    evidence,
  });

  if (line.normalizationStatus !== "valid") return output("unknown", {
    isFactEligible: false,
    reasonCodes: [
      ...(line.missingFields?.length ? ["SOURCE_FIELDS_INCOMPLETE"] : []),
      ...(line.invalidNumberFields?.length ? ["INVALID_NUMBER"] : []),
      ...(!line.missingFields?.length && !line.invalidNumberFields?.length ? ["NORMALIZATION_INCOMPLETE"] : []),
    ],
    evidence: {
      ...evidence,
      missingFields: [...(line.missingFields || [])],
      invalidNumberFields: [...(line.invalidNumberFields || [])],
    },
    warnings: ["销售明细未完成标准化，禁止进入商品关系解析。"],
  });

  const usage = context.erpSkuBusinessUsage || null;
  if (usage?.conflicts?.length || usage?.warnings?.some((warning) => warning?.code === "ERP_SKU_NOT_FOUND")) return output("unknown", {
    isFactEligible: false,
    reasonCodes: [usage.conflicts?.[0]?.code || usage.warnings[0].code || "ERP_USAGE_CONFLICT"],
    evidence: { ...evidence, erpSkuBusinessUsage: usage },
    warnings: ["用途解析存在阻断问题，禁止根据商品关系绕过用途治理。"],
  });
  const usageClassification = usage?.isConfirmed === true && usage?.isUsable === true
    ? USAGE_CLASSIFICATION[usage.usageType] || null
    : null;
  if (usageClassification) return output(usageClassification, {
    reasonCodes: [`ERP_USAGE_CONFIRMED_${usage.usageType.toUpperCase()}`],
    evidence: { ...evidence, erpSkuBusinessUsage: usage },
    warnings: usageClassification === "product_sale" ? ["AWAITING_RELATION_RESOLUTION"] : [],
  });

  const manual = context.manualClassificationRule || null;
  if (manual?.status === "active" && CLASSIFICATIONS.has(manual.classification)) return output(manual.classification, {
    reasonCodes: ["MANUAL_CLASSIFICATION_RULE"],
    evidence: {
      ...evidence,
      manualClassificationRule: {
        ruleId: manual.ruleId || null,
        classification: manual.classification,
        reviewedBy: manual.reviewedBy || null,
        reviewedAt: manual.reviewedAt || null,
      },
    },
    warnings: manual.classification === "product_sale" ? ["AWAITING_RELATION_RESOLUTION"] : [],
  });

  const relation = context.relation || null;
  const targetErpSkuId = line.erpSkuId || null;
  const relationMapping = targetErpSkuId
    ? relation?.mappings?.find((mapping) => mapping.erpSkuId === targetErpSkuId)
    : null;
  if (relation?.relationStatus === "active_complete" && relation.isUsable && relationMapping) return output("product_sale", {
    isFactEligible: true,
    reasonCodes: ["FORMAL_PRODUCT_RELATION_PRESENT"],
    evidence: {
      ...evidence,
      relationStatus: relation.relationStatus,
      relationshipShape: relation.relationshipShape || null,
      mappingId: relationMapping.mappingId || null,
    },
    warnings: ["ERP_USAGE_DEFAULTED_TO_PRODUCT"],
  });

  // ERP身份已经在进入本能力前完成精确匹配。除非用途被明确确认成非商品，
  // 否则统一进入商品关系解析；“用途尚未人工确认”不再构成业务异常。
  return output("product_sale", {
    isFactEligible: false,
    reasonCodes: ["ERP_USAGE_DEFAULT_PRODUCT"],
    evidence: {
      ...evidence,
      erpSkuBusinessUsage: usage,
      relationStatus: relation?.relationStatus || null,
    },
    warnings: ["ERP_USAGE_DEFAULTED_TO_PRODUCT", "AWAITING_RELATION_RESOLUTION"],
  });
}

export default classifySalesDetailLine;
