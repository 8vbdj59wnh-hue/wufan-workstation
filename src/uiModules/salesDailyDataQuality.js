import { registerUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js";

const money = (value) => Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (value) => value === null || value === undefined ? "暂无数据" : `${(Number(value) * 100).toFixed(1)}%`;
const healthLabels = { healthy: "健康", warning: "需要关注", error: "存在阻断问题" };
const categoryLabels = { ready: "已写入事实", identity_error: "身份异常", incomplete_structure: "货品结构不完整", missing_relation: "缺失关系", pending_relation: "关系待确认", relation_conflict: "关系冲突", excluded: "排除", accounting_auxiliary: "辅助核算", shipping_adjustment: "邮费调整", other_adjustment: "其他调整" };

export function renderSalesDailyDataQuality({ state = {}, showGovernanceEntry = false } = {}) {
  if (state.loading) return `<section class="connection-import-preview" data-module-key="sales_daily_data_quality"><div class="empty-state compact">正在读取销售日报质量…</div></section>`;
  if (state.error) return `<section class="connection-import-preview" data-module-key="sales_daily_data_quality"><div class="empty-state compact"><strong>质量数据暂不可用</strong><p>${escapeHtml(state.error)}</p></div></section>`;
  const data = state.data;
  if (!data?.hasData) return `<section class="connection-import-preview" data-module-key="sales_daily_data_quality"><div class="empty-state compact"><strong>暂无已确认销售日报批次</strong></div></section>`;
  const batch = data.batch; const coverage = data.coverage; const amounts = data.amounts; const governance = data.governance;
  const anomalyCount = Number(governance.identityErrors?.rowCount || 0) + Number(governance.conflicts?.rowCount || 0) + Number(governance.incompleteStructures?.rowCount || 0);
  const relationCount = Number(governance.relationPending?.rowCount || 0);
  const pendingCount = anomalyCount + relationCount;
  const governanceEntry = showGovernanceEntry && pendingCount > 0 ? `<details class="sales-daily-governance-entry">
      <summary>待处理数据问题 <strong>${pendingCount}</strong></summary>
      <div>${anomalyCount > 0 ? `<button type="button" class="text-button" data-workbench-go="sales-data-quality-governance">处理销售异常 <strong>${anomalyCount}</strong></button>` : ""}${relationCount > 0 ? `<button type="button" class="text-button" data-workbench-go="sales-relation-governance">确认销售关系 <strong>${relationCount}</strong></button>` : ""}</div>
    </details>` : "";
  return `<section class="connection-import-preview sales-daily-quality is-${escapeHtml(data.health.status)}" data-module-key="sales_daily_data_quality">
    <header><div><p class="eyebrow">SALES DAILY DATA QUALITY</p><h3>销售日报数据质量</h3><p>${escapeHtml(batch.fileName)} · ${escapeHtml(batch.dateStart)} 至 ${escapeHtml(batch.dateEnd)}</p></div><span class="status-pill">${escapeHtml(healthLabels[data.health.status] || data.health.status)}</span></header>
    <div class="connection-import-preview-grid"><span>批次状态<strong>${escapeHtml(batch.status)}</strong></span><span>事实数量<strong>${batch.factCount}</strong></span><span>商品行覆盖<strong>${percent(coverage.rowCoverage)}</strong></span><span>销售额覆盖<strong>${percent(amounts.salesCoverage)}</strong></span><span>利润覆盖<strong>${percent(amounts.profitCoverage)}</strong></span><span>更新时间<strong>${escapeHtml(batch.confirmedAt || "暂无记录")}</strong></span></div>
    <h4>数据覆盖</h4><div class="connection-import-preview-grid"><span>总行数<strong>${coverage.totalRows}</strong></span><span>原子明细<strong>${coverage.atomicRows}</strong></span><span>商品明细<strong>${coverage.productRows}</strong></span>${Object.entries(coverage.categories).map(([key, item]) => `<span>${escapeHtml(categoryLabels[key] || key)}<strong>${item.rows}</strong></span>`).join("")}</div>
    <h4>金额覆盖</h4><div class="connection-import-preview-grid"><span>商品销售额<strong>¥${money(amounts.productSourceSalesAmount)}</strong></span><span>已写入销售额<strong>¥${money(amounts.writtenSalesAmount)}</strong></span><span>未写入销售额<strong>¥${money(amounts.unwrittenSalesAmount)}</strong></span><span>商品利润<strong>¥${money(amounts.productSourceProfitAmount)}</strong></span><span>已写入利润<strong>¥${money(amounts.writtenProfitAmount)}</strong></span><span>未写入利润<strong>¥${money(amounts.unwrittenProfitAmount)}</strong></span></div>
    <h4>治理待办</h4><div class="connection-import-preview-grid"><span>身份异常<strong>${governance.identityErrors.rowCount}行</strong><small>影响销售额 ¥${money(governance.identityErrors.salesAmount)}</small></span><span>关系待确认<strong>${governance.relationPending.rowCount}行</strong><small>影响销售额 ¥${money(governance.relationPending.salesAmount)}</small></span><span>关系冲突<strong>${governance.conflicts.rowCount}行</strong><small>影响销售额 ¥${money(governance.conflicts.salesAmount)}</small></span><span>结构不完整<strong>${governance.incompleteStructures.rowCount}行</strong><small>影响销售额 ¥${money(governance.incompleteStructures.salesAmount)}</small></span></div>
    <footer><small>只展示现有批次、治理状态和事实覆盖；不会重新解析Excel或自动治理。</small>${governanceEntry}</footer>
  </section>`;
}

registerUiModule({ moduleKey: "sales_daily_data_quality", name: "SalesDailyDataQuality", domain: "business_links", description: "展示销售日报批次、事实覆盖、金额覆盖和治理待办。", dependencies: ["QuerySalesDailyDataQuality"], configSchema: { showGovernanceEntry: "boolean" }, render: renderSalesDailyDataQuality });
