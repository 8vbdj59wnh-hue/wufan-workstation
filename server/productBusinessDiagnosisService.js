import { getProductBusinessReadModel } from "./productBusinessReadModel.js";
import { getProductImprovementCenter } from "./productManagementV2Service.js";
import { getProductStrategy } from "./productStrategyService.js";

const terminalActionStatuses = new Set(["done", "completed", "canceled", "cancelled", "stopped", "terminated"]);
const strategyGrowthPattern = /扩大|增长|提升销售|提高销量|拓展|扩张|增加销量|增加销售/;

function insight(code, title, explanation, source, evidence = {}) {
  return { code, title, explanation, source, evidence };
}

function improvementResponse(improvement, issueTypes) {
  const matching = (improvement?.improvements ?? []).filter((item) => issueTypes.includes(item.issueType) && !terminalActionStatuses.has(item.actionStatus));
  return matching.length ? { status: "responding", label: `已有 ${matching.length} 项改善行动响应`, actionIds: matching.map((item) => item.actionId) }
    : { status: "unconfirmed", label: "待管理者确认", actionIds: [] };
}

function statusFromHealth(health, hasRisk) {
  const healthCode = health?.overall?.code ?? "no_data";
  const code = healthCode === "risk" ? "risk" : healthCode === "attention" || hasRisk ? "attention" : healthCode === "healthy" ? "normal" : "no_data";
  return { code, label: { normal: "正常", attention: "关注", risk: "风险", no_data: "暂无数据" }[code],
    emoji: { normal: "🟢", attention: "🟡", risk: "🔴", no_data: "⚪" }[code] };
}

/**
 * 经营诊断提供者稳定接口。未来 AI 增强实现可替换 diagnose，页面输出结构不变。
 */
export class ProductDiagnosisProvider {
  diagnose() { throw new Error("产品经营诊断提供者尚未实现。"); }
}

export class RuleProductDiagnosisProvider extends ProductDiagnosisProvider {
  constructor() { super(); this.id = "rule"; this.version = "product-diagnosis-phase5-v1"; }

  diagnose({ business, health, strategy = null, improvement = null, period = null }) {
    const dimensions = health?.dimensions ?? {}; const risks = []; const advantages = []; const focusDirections = [];
    const addRisk = (value, issueTypes) => risks.push({ ...value, response: improvementResponse(improvement, issueTypes) });

    if (dimensions.sales?.code === "down") addRisk(insight("sales_decline", "销售趋势下降", dimensions.sales.explanation, "ProductHealthAnalysis.sales", dimensions.sales.evidence), ["sales_decline"]);
    if (dimensions.inventory?.code === "backlog") addRisk(insight("inventory_backlog", "库存存在积压风险", dimensions.inventory.explanation, "ProductHealthAnalysis.inventory", dimensions.inventory.evidence), ["inventory_backlog"]);
    if (dimensions.inventory?.code === "stockout") addRisk(insight("inventory_stockout", "库存存在缺货风险", dimensions.inventory.explanation, "ProductHealthAnalysis.inventory", dimensions.inventory.evidence), ["stockout_risk"]);
    if (dimensions.inventory?.code === "attention") addRisk(insight("inventory_attention", "库存需要关注", dimensions.inventory.explanation, "ProductHealthAnalysis.inventory", dimensions.inventory.evidence), ["inventory_backlog", "stockout_risk"]);
    if (dimensions.profit?.code === "low") addRisk(insight("profit_low", "盈利能力需要关注", dimensions.profit.explanation, "ProductHealthAnalysis.profit", dimensions.profit.evidence), ["gross_margin_insufficient", "cost_high"]);
    if (dimensions.links?.code === "needs_optimization" && health?.overall?.code !== "no_data") addRisk(insight("link_performance", "销售链接表现需要关注", dimensions.links.explanation, "ProductHealthAnalysis.links", dimensions.links.evidence), ["sales_link_performance", "conversion_rate_low", "detail_page_issue"]);

    if (dimensions.sales?.code === "growth") advantages.push(insight("sales_growth", "销售趋势增长", dimensions.sales.explanation, "ProductBusinessReadModel.sales", dimensions.sales.evidence));
    if (dimensions.sales?.code === "stable" && business?.sales?.factCount > 0) advantages.push(insight("sales_stable", "销售趋势稳定", dimensions.sales.explanation, "ProductBusinessReadModel.sales", dimensions.sales.evidence));
    if (["excellent", "normal"].includes(dimensions.profit?.code)) advantages.push(insight("profit_healthy", dimensions.profit.code === "excellent" ? "毛利表现优秀" : "毛利表现正常", dimensions.profit.explanation, "ProductBusinessReadModel.profit", dimensions.profit.evidence));
    if (dimensions.inventory?.code === "healthy") advantages.push(insight("inventory_healthy", "库存与销售匹配", dimensions.inventory.explanation, "ProductBusinessReadModel.inventory", dimensions.inventory.evidence));
    if (dimensions.links?.code === "excellent") advantages.push(insight("links_excellent", "关联销售链接表现良好", dimensions.links.explanation, "ProductBusinessReadModel.links", dimensions.links.evidence));

    const currentStrategy = strategy?.current?.content; const role = currentStrategy?.positioning?.productRole ?? "";
    const strategyText = `${currentStrategy?.management?.currentStrategy ?? ""} ${(currentStrategy?.nextStrategies ?? []).map((item) => item.content).join(" ")}`;
    const growthIntent = role === "核心产品" || strategyGrowthPattern.test(strategyText);
    if (growthIntent && dimensions.sales?.code === "down") {
      const explanation = role === "核心产品"
        ? `产品角色为“核心产品”，但现有销售事实显示连续周期下降。`
        : "当前战略包含扩大或增长方向，但现有销售事实显示连续周期下降。";
      addRisk(insight("strategy_sales_gap", "当前经营结果与战略方向存在偏差", explanation, "ProductStrategy + ProductBusinessReadModel.sales",
        { strategyVersion: strategy.current.version, productRole: role, strategyPeriod: currentStrategy.management?.periodLabel ?? "", salesTrend: dimensions.sales.evidence }), ["sales_decline"]);
    }

    const riskCodes = new Set(risks.map((item) => item.code));
    if (riskCodes.has("sales_decline")) focusDirections.push(insight("review_sales_decline", "分析销售下降原因", "关注周期销售变化及影响因素，由管理者判断是否需要行动。", "RuleProductDiagnosisProvider"));
    if (riskCodes.has("link_performance") || riskCodes.has("sales_decline")) focusDirections.push(insight("review_conversion", "检查详情页与链接转化表现", "仅作经营关注提示，不自动得出根因或创建行动。", "RuleProductDiagnosisProvider"));
    if (["inventory_backlog", "inventory_stockout", "inventory_attention"].some((code) => riskCodes.has(code))) focusDirections.push(insight("review_inventory", "评估库存策略", "关注库存覆盖周期与销售节奏是否匹配。", "RuleProductDiagnosisProvider"));
    if (riskCodes.has("profit_low")) focusDirections.push(insight("review_profit", "关注成本、定价与毛利变化", "利润事实不足时不做推算。", "RuleProductDiagnosisProvider"));
    if (riskCodes.has("strategy_sales_gap")) focusDirections.push(insight("review_strategy_gap", "复核战略目标与当前经营表现的差异", "诊断只提示偏差，不自动修改战略。", "RuleProductDiagnosisProvider"));

    const status = statusFromHealth(health, risks.length > 0);
    const primaryReasons = risks.length ? risks.slice(0, 3) : status.code === "no_data" ? [] : advantages.length ? advantages.slice(0, 2)
      : [insight("no_triggered_risk", "未触发已定义风险规则", "现有可用经营维度未触发销售、库存、利润或链接风险规则。", "RuleProductDiagnosisProvider")];
    if (!focusDirections.length && status.code !== "no_data") focusDirections.push(insight("continue_observation", "持续关注销售、库存与利润变化", "当前未触发需要特别关注的规则。", "RuleProductDiagnosisProvider"));

    return { productId: business.id, productName: business.name, status, primaryReasons, advantages, risks, focusDirections,
      sourceSummary: { period: period ?? health?.evaluatedPeriod ?? null, strategyVersion: strategy?.current?.version ?? null,
        currentImprovementCount: (improvement?.improvements ?? []).filter((item) => !terminalActionStatuses.has(item.actionStatus)).length,
        availableDimensionCount: health?.availableDimensionCount ?? 0 },
      provider: { id: this.id, version: this.version, replaceable: true }, readOnly: true, createsActions: false };
  }
}

export const ruleProductDiagnosisProvider = new RuleProductDiagnosisProvider();

export function diagnoseProductBusinessContext(context, provider = ruleProductDiagnosisProvider) {
  return provider.diagnose(context);
}

export function getProductBusinessDiagnosis(productId, options = {}, provider = ruleProductDiagnosisProvider) {
  const { periodQuery = null, ...readOptions } = options;
  const result = getProductBusinessReadModel({ range: "30d", ...(periodQuery ?? {}), productId, page: 1, pageSize: 1 }, readOptions);
  const business = result.items[0];
  if (!business || business.id !== String(productId ?? "").trim()) { const error = new Error("产品不存在或无权查看。"); error.statusCode = 404; throw error; }
  const strategy = getProductStrategy(productId, { visibleProductIds: readOptions.visibleProductIds ?? null });
  const improvement = getProductImprovementCenter(productId, business.healthAnalysis);
  return provider.diagnose({ business, health: business.healthAnalysis, strategy, improvement, period: result.period });
}

export function attachProductDiagnosisSummaries(readModel, provider = ruleProductDiagnosisProvider) {
  return { ...readModel, items: (readModel.items ?? []).map((business) => ({ ...business,
    diagnosis: provider.diagnose({ business, health: business.healthAnalysis, period: readModel.period }) })) };
}
