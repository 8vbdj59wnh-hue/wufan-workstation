import { commitErpGoodsDataSync, commitInventoryDataSync, commitPlatformGoodsDataSync, createDataSyncBatch, getCurrentUser, loadDataCenterProductDetail, loadDataCenterView, loadDataSyncCenter, loadErpGoodsDataSyncPreview, loadInventoryDataSyncPreview, loadPlatformGoodsDataSyncPreview, previewErpGoodsDataSync, previewInventoryDataSync, previewPlatformGoodsDataSync, resolveAssetUrl, saveWangdianShopMapping, updateDataSyncTaskStatus } from "./appState.js";
import { canAccessModule } from "./permissions.js";

let view = "trends";
let loading = false;
let error = "";
let result = null;
let detail = null;
let syncPreview = null;
let platformSyncPreview = null;
let inventorySyncPreview = null;
let query = { search: "", page: 1, pageSize: 48, direction: "focus", status: "", sort: "" };

const viewConfig = {
  trends: { label: "趋势变化", endpoint: "trends", description: "识别产品sales30d历史序列的上涨、下滑、稳定和数据不足。" },
  "slow-moving": { label: "长期滞销", endpoint: "slow-moving", description: "识别有库存且长期处于低销量区间的产品。" },
  capital: { label: "资金占用", endpoint: "capital-occupation", description: "按ERP规格实际库存 × 单位成本汇总库存资金。" },
  sync: { label: "数据同步", endpoint: "sync", description: "统一管理外部数据同步任务、执行批次、日志与异常。", adminOnly: true },
};

function isAdmin() {
  const user = getCurrentUser();
  return ["admin", "system_admin"].includes(user?.role) || user?.authRole === "admin";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]);
}

function number(value, digits = 0) {
  if (value === null || value === undefined) return "—";
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function percent(value) {
  return value === null || value === undefined ? "—" : `${(Number(value) * 100).toFixed(1)}%`;
}

function image(product) {
  return product.image
    ? `<img src="${escapeHtml(resolveAssetUrl(product.image))}" alt="" loading="lazy" />`
    : `<span>无图</span>`;
}

function statusLabel(status) {
  return ({
    up: "上涨", down: "下滑", stable: "稳定", volatile: "波动", insufficient: "数据不足",
    observing: "待观察", suspected: "疑似滞销", long_term: "长期滞销", invalid: "数据异常",
  })[status] ?? status;
}

function sortOptions() {
  if (view === "trends") return [["", "按趋势强度"], ["sales", "按近30天销量"], ["stock", "按当前库存"]];
  if (view === "slow-moving") return [["", "按滞销程度"], ["days", "按持续天数"], ["capital", "按库存金额"]];
  return [["", "按资金占用"], ["sales", "按近30天销量"], ["stock", "按实际库存"]];
}

function renderOverview() {
  if (!result) return "";
  if (view === "sync") return "";
  if (view === "trends") {
    return `${result.availableBusinessDays < 7 ? `<div class="data-center-notice"><strong>历史数据正在积累</strong><p>当前已有${result.availableBusinessDays ?? 0}个业务日快照；2—6日仅说明较前一阶段变化，不作正式趋势判断，正式趋势至少需要7个业务日。</p></div>` : ""}
    <div class="data-center-overview">
      <div><span>最新业务日期</span><strong>${escapeHtml(result.latestBusinessDate || "—")}</strong></div>
      <div><span>历史业务日</span><strong>${result.availableBusinessDays ?? 0}</strong></div>
      <div><span>上涨</span><strong>${result.counts?.up ?? 0}</strong></div>
      <div><span>下滑</span><strong>${result.counts?.down ?? 0}</strong></div>
      <div><span>稳定/波动</span><strong>${(result.counts?.stable ?? 0) + (result.counts?.volatile ?? 0)}</strong></div>
      <div><span>数据不足</span><strong>${result.counts?.insufficient ?? 0}</strong></div>
    </div>`;
  }
  if (view === "slow-moving") {
    return `<div class="data-center-overview">
      <div><span>最新业务日期</span><strong>${escapeHtml(result.latestBusinessDate || "—")}</strong></div>
      <div><span>历史业务日</span><strong>${result.availableBusinessDays ?? 0}</strong></div>
      <div><span>正式判定门槛</span><strong>30 / 60日</strong></div>
    </div>
    ${result.availableBusinessDays < 30 ? `<div class="data-center-notice"><strong>长期滞销需要至少30个业务日数据</strong><p>当前数据仍在积累，仅展示待观察产品，不作正式滞销判断。</p></div>` : ""}`;
  }
  const summary = result.summary ?? {};
  return `<div class="data-center-overview">
    <div><span>最新业务日期</span><strong>${escapeHtml(result.latestBusinessDate || "—")}</strong></div>
    <div><span>可计算资金总额</span><strong>¥${number(summary.totalAmount, 2)}</strong></div>
    <div><span>数据完整产品</span><strong>${summary.completeProducts ?? 0}</strong></div>
    <div><span>缺少成本/实际库存</span><strong>${summary.missingCostProducts ?? 0}</strong></div>
    <div><span>最高占用</span><strong>¥${number(summary.highestAmount, 2)}</strong></div>
    <div><span>前20占比</span><strong>${percent(summary.top20Share)}</strong></div>
  </div>`;
}

function renderRows() {
  if (view === "sync") return renderDataSyncCenter();
  const rows = result?.rows ?? [];
  if (!rows.length) return `<div class="empty-state"><strong>当前没有符合条件的产品</strong><p>数据中心不会为了产生结果而降低判断阈值。</p></div>`;
  if (view === "trends") {
    return `<div class="data-center-list">${rows.map((row) => `<article class="data-center-row">
      <div class="data-center-product-image">${image(row)}</div>
      <div class="data-center-product"><strong>${escapeHtml(row.productName)}</strong><span>${escapeHtml(row.skuCode)}</span><small>${escapeHtml(row.startDate)}—${escapeHtml(row.endDate)}</small></div>
      <div><span>趋势</span><strong>${escapeHtml(row.strength)}</strong></div>
      <div><span>sales30d</span><strong>${number(row.windowStartValue)} → ${number(row.currentSales30d)}</strong></div>
      <div><span>变化</span><strong>${number(row.changeAmount)} / ${percent(row.changeRate)}</strong></div>
      <div><span>连续方向</span><strong>${row.consecutiveDays ?? 0}日</strong></div>
      <div><span>当前库存</span><strong>${number(row.currentStock)}</strong></div>
      <p>${escapeHtml(row.reason)}</p>
      <button class="text-button" data-action="open-data-center-detail" data-product-id="${escapeHtml(row.productId)}">查看分析</button>
    </article>`).join("")}</div>`;
  }
  if (view === "slow-moving") {
    return `<div class="data-center-list">${rows.map((row) => `<article class="data-center-row">
      <div class="data-center-product-image">${image(row)}</div>
      <div class="data-center-product"><strong>${escapeHtml(row.productName)}</strong><span>${escapeHtml(row.skuCode)}</span><small>首次观察 ${escapeHtml(row.firstObservedAt)}</small></div>
      <div><span>状态</span><strong>${escapeHtml(statusLabel(row.status))}</strong></div>
      <div><span>当前库存</span><strong>${number(row.currentStock)}</strong></div>
      <div><span>sales30d</span><strong>${number(row.currentSales30d)}</strong></div>
      <div><span>连续低销量日</span><strong>${row.continuousLowDays ?? 0}</strong></div>
      <div><span>当前库存金额</span><strong>${row.currentCapitalAmount === null ? "—" : `¥${number(row.currentCapitalAmount, 2)}`}</strong></div>
      <p>${escapeHtml(row.reason)}</p>
      <button class="text-button" data-action="open-data-center-detail" data-product-id="${escapeHtml(row.productId)}">查看分析</button>
    </article>`).join("")}</div>`;
  }
  return `<div class="data-center-list">${rows.map((row) => `<article class="data-center-row">
    <div class="data-center-product-image">${image(row)}</div>
    <div class="data-center-product"><strong>${escapeHtml(row.productName)}</strong><span>${escapeHtml(row.skuCode)}</span><small>${row.rank ? `排名 ${row.rank}` : "金额数据不完整"}</small></div>
    <div><span>实际库存</span><strong>${number(row.actualStock)}</strong></div>
    <div><span>单位成本区间</span><strong>${row.minUnitCost === null ? "—" : `¥${number(row.minUnitCost, 2)}—¥${number(row.maxUnitCost, 2)}`}</strong></div>
    <div><span>库存资金</span><strong>${row.amount === null ? "无法计算" : `¥${number(row.amount, 2)}`}</strong></div>
    <div><span>近30天销量</span><strong>${number(row.currentSales30d)}</strong></div>
    <div><span>资金占比</span><strong>${percent(row.share)}</strong></div>
    <p>${escapeHtml(row.reason)}</p>
    <button class="text-button" data-action="open-data-center-detail" data-product-id="${escapeHtml(row.productId)}">查看分析</button>
  </article>`).join("")}</div>`;
}

function renderDataSyncCenter() {
  if (!result) return "";
  const taskStatus = { enabled: "已启用", paused: "已暂停" };
  const batchStatus = { queued: "等待", running: "执行中", preview_ready: "待确认", superseded: "历史预览", succeeded: "成功", partial: "部分成功", failed: "失败" };
  const erpTask = (result.tasks ?? []).find((task) => task.taskCode === "erp_goods");
  const platformTask = (result.tasks ?? []).find((task) => task.taskCode === "wangdian_platform_goods");
  const inventoryTask = (result.tasks ?? []).find((task) => task.taskCode === "wangdian_inventory");
  const today = new Date().toLocaleDateString("sv-SE");
  return `<div class="data-sync-center">
    <div class="data-center-overview">
      <div><span>同步任务</span><strong>${result.counts?.taskCount ?? 0}</strong></div>
      <div><span>已启用</span><strong>${result.counts?.enabledTaskCount ?? 0}</strong></div>
      <div><span>执行中/等待</span><strong>${result.counts?.activeBatchCount ?? 0}</strong></div>
      <div><span>待处理异常</span><strong>${result.counts?.openExceptionCount ?? 0}</strong></div>
      <div><span>历史ERP同步</span><strong>${result.legacy?.erpSyncRuns ?? 0}</strong></div>
      <div><span>历史导入批次</span><strong>${result.legacy?.erpImportBatches ?? 0}</strong></div>
    </div>
    <section><h2>同步任务</h2><div class="table-wrap"><table class="data-table"><thead><tr><th>名称</th><th>来源</th><th>方式</th><th>默认模式</th><th>周期</th><th>最近成功</th><th>下次执行</th><th>状态</th><th>操作</th></tr></thead><tbody>
      ${(result.tasks ?? []).map((task) => `<tr><td><strong>${escapeHtml(task.name)}</strong><small>${escapeHtml(task.sourceMethod || task.syncType)}</small></td><td>${escapeHtml(task.sourceType)}</td><td>${task.executionMode === "both" ? "自动 + 手动" : "手动"}</td><td>${task.defaultSyncMode === "full" ? "全量" : "增量"}</td><td>${escapeHtml(task.scheduleDescription || "人工触发")}</td><td>${formatDate(task.lastSuccessAt)}</td><td>${formatDate(task.nextRunAt)}</td><td><span class="status-badge">${taskStatus[task.status] || task.status}</span></td><td><button class="text-button" data-action="toggle-data-sync-task" data-task-id="${escapeHtml(task.id)}" data-next-status="${task.status === "enabled" ? "paused" : "enabled"}">${task.status === "enabled" ? "暂停" : "启用"}</button>${task.status === "enabled" && !["erp_goods", "wangdian_platform_goods", "wangdian_inventory"].includes(task.taskCode) ? `<button class="text-button" data-action="create-data-sync-batch" data-task-id="${escapeHtml(task.id)}" data-sync-mode="${escapeHtml(task.defaultSyncMode)}">创建手动批次</button>` : ""}</td></tr>`).join("")}
    </tbody></table></div></section>
    ${erpTask ? `<section><h2>ERP货品同步执行</h2>${erpTask.status !== "enabled" ? `<div class="data-center-notice">ERP货品同步任务当前已暂停。启用后才可生成全量或增量预览；启用自动调度前请先完成一次全量同步。</div>` : `<form id="erp-data-sync-form" class="data-center-filter">
      <label><span>开始时间</span><input name="requestStart" type="datetime-local" value="2021-01-01T00:00" /></label>
      <label><span>结束时间</span><input name="requestEnd" type="datetime-local" value="${today}T23:59" /></label>
      <button type="button" class="secondary-button" data-action="preview-erp-data-sync" data-sync-mode="full" data-task-id="${escapeHtml(erpTask.id)}">生成全量预览</button>
      <button type="button" class="primary-button" data-action="preview-erp-data-sync" data-sync-mode="incremental" data-task-id="${escapeHtml(erpTask.id)}">执行增量预览</button>
    </form>`}
    ${syncPreview ? `<div class="data-center-notice"><strong>${syncPreview.isCurrent === false ? "历史预览" : "当前有效预览"} V${syncPreview.summary?.previewVersion ?? "—"}</strong><p>统一批次：${escapeHtml(syncPreview.dataSyncBatch?.id)}；ERP货品 ${syncPreview.summary?.validGoods ?? 0}；SKU ${syncPreview.summary?.total ?? 0}；新增 ${syncPreview.summary?.created ?? 0}；更新 ${syncPreview.summary?.updated ?? 0}；异常 ${syncPreview.summary?.error ?? 0}。</p>${syncPreview.isCurrent === false ? `<span>该版本已被更新预览替代，仅供查看。</span>` : `<button class="primary-button" data-action="commit-erp-data-sync" data-batch-id="${escapeHtml(syncPreview.dataSyncBatch?.id)}" ${syncPreview.summary?.error ? "disabled" : ""}>确认提交当前预览</button>`}</div>` : ""}</section>` : ""}
    ${platformTask ? `<section><h2>平台货品关系同步执行</h2>${platformTask.status !== "enabled" ? `<div class="data-center-notice">平台货品关系同步任务当前已暂停。请先维护旺店通店铺映射并完成一次全量同步，再启用自动调度。</div>` : `<form id="platform-data-sync-form" class="data-center-filter">
      <label><span>开始时间</span><input name="requestStart" type="datetime-local" value="2021-01-01T00:00" /></label>
      <label><span>结束时间</span><input name="requestEnd" type="datetime-local" value="${today}T23:59" /></label>
      <label><span>平台范围</span><select name="platform"><option value="">全部平台</option>${[...new Set((result.salesShops ?? []).map((shop) => shop.platform))].map((platform) => `<option value="${escapeHtml(platform)}">${escapeHtml(platform)}</option>`).join("")}</select></label>
      <label><span>店铺范围</span><select name="shopId"><option value="">全部店铺</option>${(result.salesShops ?? []).map((shop) => `<option value="${escapeHtml(shop.id)}">${escapeHtml(`${shop.platform} · ${shop.displayName || shop.shopName}`)}</option>`).join("")}</select></label>
      <button type="button" class="secondary-button" data-action="preview-platform-data-sync" data-sync-mode="full" data-task-id="${escapeHtml(platformTask.id)}">生成全量预览</button>
      <button type="button" class="primary-button" data-action="preview-platform-data-sync" data-sync-mode="incremental" data-task-id="${escapeHtml(platformTask.id)}">执行增量预览</button>
    </form>`}
    <form id="wangdian-shop-mapping-form" class="data-center-filter"><input name="wangdianShopNo" placeholder="旺店通店铺编号" required /><select name="shopId" required><option value="">选择系统店铺</option>${(result.salesShops ?? []).map((shop) => `<option value="${escapeHtml(shop.id)}">${escapeHtml(`${shop.platform} · ${shop.displayName || shop.shopName}`)}</option>`).join("")}</select><button class="secondary-button" type="submit">保存店铺映射</button></form>
    ${(result.wangdianShopMappings ?? []).length ? `<p>已映射：${result.wangdianShopMappings.map((item) => escapeHtml(`${item.wangdianShopNo} → ${item.platform} · ${item.displayName || item.shopName}`)).join("；")}</p>` : `<p class="form-note">尚未配置旺店通店铺映射。</p>`}
    ${platformSyncPreview ? `<div class="data-center-notice"><strong>${platformSyncPreview.isCurrent === false ? "历史预览" : "当前有效预览"}</strong><p>统一批次：${escapeHtml(platformSyncPreview.dataSyncBatch?.id)}；原始行 ${platformSyncPreview.summary?.total ?? 0}；有效匹配 ${platformSyncPreview.summary?.matched ?? 0}；新增 ${platformSyncPreview.summary?.created ?? 0}；更新 ${platformSyncPreview.summary?.updated ?? 0}；异常 ${platformSyncPreview.summary?.exceptionCount ?? 0}。</p>${platformSyncPreview.isCurrent === false ? `<span>该版本已被更新预览替代，仅供查看。</span>` : `<button class="primary-button" data-action="commit-platform-data-sync" data-batch-id="${escapeHtml(platformSyncPreview.dataSyncBatch?.id)}" ${platformSyncPreview.summary?.canCommit === false ? "disabled" : ""}>确认提交当前预览</button>`}</div>` : ""}</section>` : ""}
    ${inventoryTask ? `<section><h2>库存同步执行</h2>${inventoryTask.status !== "enabled" ? `<div class="data-center-notice">库存同步任务当前已暂停。首次全量同步并确认库存口径后，再启用自动调度。</div>` : `<form id="inventory-data-sync-form" class="data-center-filter">
      <label><span>业务日期</span><input name="businessDate" type="date" value="${today}" /></label>
      <label><span>开始时间</span><input name="requestStart" type="datetime-local" value="${today}T00:00" /></label>
      <label><span>结束时间</span><input name="requestEnd" type="datetime-local" value="${today}T23:59" /></label>
      <input name="specNos" placeholder="SKU范围（逗号分隔，空为全部）" />
      <input name="warehouseIds" placeholder="仓库ID范围（逗号分隔，空为全部）" />
      <button type="button" class="secondary-button" data-action="preview-inventory-data-sync" data-sync-mode="full" data-task-id="${escapeHtml(inventoryTask.id)}">生成全量预览</button>
      <button type="button" class="primary-button" data-action="preview-inventory-data-sync" data-sync-mode="incremental" data-task-id="${escapeHtml(inventoryTask.id)}">执行增量预览</button>
    </form>`}
    ${inventorySyncPreview ? `<div class="data-center-notice"><strong>${inventorySyncPreview.isCurrent === false ? "历史预览" : "当前有效预览"}</strong><p>业务日期 ${escapeHtml(inventorySyncPreview.summary?.businessDate)}；原始行 ${inventorySyncPreview.summary?.total ?? 0}；有效仓库事实 ${inventorySyncPreview.summary?.matched ?? 0}；新增 ${inventorySyncPreview.summary?.created ?? 0}；更新 ${inventorySyncPreview.summary?.updated ?? 0}；异常 ${inventorySyncPreview.summary?.exceptionCount ?? 0}。</p>${inventorySyncPreview.isCurrent === false ? `<span>该版本已被更新预览替代，仅供查看。</span>` : `<button class="primary-button" data-action="commit-inventory-data-sync" data-batch-id="${escapeHtml(inventorySyncPreview.dataSyncBatch?.id)}">确认提交当前预览</button>`}</div>` : ""}</section>` : ""}
    <section><h2>同步历史</h2><div class="table-wrap"><table class="data-table"><thead><tr><th>任务</th><th>触发</th><th>模式</th><th>状态</th><th>数量</th><th>新增/更新/失效</th><th>异常</th><th>开始</th><th>结束</th><th>操作</th></tr></thead><tbody>${(result.batches ?? []).length ? result.batches.map((batch) => `<tr><td>${escapeHtml(batch.taskName)}</td><td>${batch.triggerMode === "automatic" ? "自动" : "手动"}</td><td>${batch.syncMode === "full" ? "全量" : "增量"}</td><td>${batchStatus[batch.status] || batch.status}</td><td>${batch.totalCount}</td><td>${batch.createdCount}/${batch.updatedCount}/${batch.invalidatedCount}</td><td>${batch.exceptionCount}</td><td>${formatDate(batch.startedAt || batch.createdAt)}</td><td>${formatDate(batch.completedAt)}</td><td>${["preview_ready", "superseded"].includes(batch.status) && batch.sourceBatchType === "erp_import_batch" ? `<button class="text-button" data-action="load-erp-data-sync-preview" data-batch-id="${escapeHtml(batch.id)}">查看ERP预览</button>` : ["preview_ready", "superseded"].includes(batch.status) && batch.sourceBatchType === "wangdian_platform_goods_sync" ? `<button class="text-button" data-action="load-platform-data-sync-preview" data-batch-id="${escapeHtml(batch.id)}">查看平台SKU预览</button>` : ["preview_ready", "superseded"].includes(batch.status) && batch.sourceBatchType === "wangdian_inventory_sync" ? `<button class="text-button" data-action="load-inventory-data-sync-preview" data-batch-id="${escapeHtml(batch.id)}">查看库存预览</button>` : "—"}</td></tr>`).join("") : `<tr><td colspan="10">尚无统一框架批次；历史ERP同步记录保持在原系统中。</td></tr>`}</tbody></table></div></section>
    <section><h2>异常记录</h2><div class="table-wrap"><table class="data-table"><thead><tr><th>任务</th><th>类型</th><th>级别</th><th>说明</th><th>状态</th><th>时间</th></tr></thead><tbody>${(result.exceptions ?? []).length ? result.exceptions.map((item) => `<tr><td>${escapeHtml(item.taskName)}</td><td>${escapeHtml(item.exceptionType)}</td><td>${escapeHtml(item.severity)}</td><td>${escapeHtml(item.message)}</td><td>${item.status === "open" ? "待处理" : "已处理"}</td><td>${formatDate(item.createdAt)}</td></tr>`).join("") : `<tr><td colspan="6">当前没有同步异常</td></tr>`}</tbody></table></div></section>
  </div>`;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
}

function renderDetail() {
  if (!detail) return "";
  const current = detail.current;
  const capitalByDate = new Map((detail.capitalHistory ?? []).map((item) => [item.businessDate, item.amount]));
  const points = detail.history.map((item) => `${item.businessDate}：sales30d ${number(item.sales30d)}，sales7d ${number(item.sales7d)}，库存 ${number(item.totalStock)}，库存资金 ${capitalByDate.get(item.businessDate) === null ? "无法计算" : `¥${number(capitalByDate.get(item.businessDate), 2)}`}，平台/店铺/链接 ${item.platformCount}/${item.shopCount}/${item.salesLinkCount}`).join("<br>");
  return `<div class="modal-backdrop"><section class="modal-panel data-center-detail">
    <header class="modal-header"><div><h2>${escapeHtml(current.productName)}</h2><p>${escapeHtml(current.skuCode)}</p></div><button class="icon-button" data-action="close-data-center-detail">×</button></header>
    <div class="modal-body">
      <div class="data-center-overview"><div><span>当前库存</span><strong>${number(current.totalStock)}</strong></div><div><span>sales30d</span><strong>${number(current.sales30d)}</strong></div><div><span>平台/店铺/链接</span><strong>${current.platformCount}/${current.shopCount}/${current.salesLinkCount}</strong></div></div>
      <section><h3>历史变化</h3><p class="data-center-history">${points}</p></section>
      <section><h3>本次判断</h3><p>${escapeHtml(detail.judgment || "—")}</p></section>
      <section><h3>数据来源</h3><p>${escapeHtml(detail.dataSource.firstBusinessDate)}—${escapeHtml(detail.dataSource.latestBusinessDate)}；使用每日当前正式快照版本。${detail.dataSource.missingFields?.length ? `缺失：${escapeHtml(detail.dataSource.missingFields.join("、"))}。` : "核心计算字段完整。"}</p></section>
    </div>
    <footer class="modal-footer">${canAccessModule(getCurrentUser(), "products") ? `<button class="secondary-button" data-action="open-data-center-product" data-product-id="${escapeHtml(detail.productId)}">查看产品中心详情</button>` : ""}<button class="primary-button" data-action="close-data-center-detail">关闭</button></footer>
  </section></div>`;
}

export function renderDataCenterPage() {
  const config = viewConfig[view];
  return `<section class="data-center-page">
    <div class="section-heading"><div><h1>数据中心</h1><p>${escapeHtml(config.description)}</p></div><button type="button" class="secondary-button" data-action="open-operation-dashboard">经营驾驶舱</button></div>
    <div class="subtabs">${Object.entries(viewConfig).filter(([, item]) => !item.adminOnly || isAdmin()).map(([key, item]) => `<button class="${view === key ? "is-active" : ""}" data-action="switch-data-center-view" data-view="${key}">${item.label}</button>`).join("")}</div>
    ${view === "sync" ? "" : `<form id="data-center-filter" class="data-center-filter"><input name="search" value="${escapeHtml(query.search)}" placeholder="搜索产品名称或编码" />
      ${view === "trends" ? `<select name="direction"><option value="focus" ${query.direction === "focus" ? "selected" : ""}>重点：上涨与下滑</option><option value="" ${query.direction === "" ? "selected" : ""}>全部趋势</option>${["up", "down", "stable", "volatile", "insufficient"].map((item) => `<option value="${item}" ${query.direction === item ? "selected" : ""}>${statusLabel(item)}</option>`).join("")}</select>` : ""}
      ${view === "slow-moving" ? `<select name="status"><option value="">全部状态</option>${["long_term", "suspected", "observing", "invalid"].map((item) => `<option value="${item}" ${query.status === item ? "selected" : ""}>${statusLabel(item)}</option>`).join("")}</select>` : ""}
      <select name="sort">${sortOptions().map(([value, label]) => `<option value="${value}" ${query.sort === value ? "selected" : ""}>${label}</option>`).join("")}</select>
      <button class="secondary-button" type="submit">筛选</button></form>`}
    ${loading ? `<div class="form-note">正在计算经营结果…</div>` : error ? `<div class="form-error">${escapeHtml(error)}</div>` : `${renderOverview()}${renderRows()}`}
    ${result?.pagination ? `<div class="pagination"><button data-action="data-center-page" data-page="${result.pagination.page - 1}" ${result.pagination.page <= 1 ? "disabled" : ""}>上一页</button><span>${result.pagination.page} / ${result.pagination.pages}，共 ${result.pagination.total} 项</span><button data-action="data-center-page" data-page="${result.pagination.page + 1}" ${result.pagination.page >= result.pagination.pages ? "disabled" : ""}>下一页</button></div>` : ""}
    ${renderDetail()}
  </section>`;
}

async function refresh(rerender) {
  loading = true; error = ""; rerender();
  try {
    result = view === "sync" ? await loadDataSyncCenter() : await loadDataCenterView(viewConfig[view].endpoint, query);
  } catch (caught) {
    error = caught.message || "数据中心读取失败。";
  }
  loading = false; rerender();
}

export function bindDataCenterPageEvents(rerender) {
  if (!result && !loading) refresh(rerender);
  document.querySelectorAll("[data-action='switch-data-center-view']").forEach((button) => button.addEventListener("click", () => {
    view = button.dataset.view; query = { search: "", page: 1, pageSize: 48, direction: button.dataset.view === "trends" ? "focus" : "", status: "", sort: "" }; result = null; detail = null; refresh(rerender);
  }));
  document.querySelector("#data-center-filter")?.addEventListener("submit", (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    query = { ...query, search: String(form.get("search") || ""), direction: String(form.get("direction") || ""), status: String(form.get("status") || ""), sort: String(form.get("sort") || ""), page: 1 };
    refresh(rerender);
  });
  document.querySelectorAll("[data-action='data-center-page']").forEach((button) => button.addEventListener("click", () => {
    query.page = Number(button.dataset.page); refresh(rerender);
  }));
  document.querySelectorAll("[data-action='open-data-center-detail']").forEach((button) => button.addEventListener("click", async () => {
    try { detail = (await loadDataCenterProductDetail(button.dataset.productId, view)).detail; rerender(); } catch (caught) { error = caught.message; rerender(); }
  }));
  document.querySelector("[data-action='open-data-center-product']")?.addEventListener("click", (event) => {
    window.location.hash = `products/${encodeURIComponent(event.currentTarget.dataset.productId)}`;
    rerender();
  });
  document.querySelectorAll("[data-action='close-data-center-detail']").forEach((button) => button.addEventListener("click", () => { detail = null; rerender(); }));
  document.querySelector("[data-action='open-operation-dashboard']")?.addEventListener("click", () => { window.location.hash = "operationDashboard"; });
  document.querySelectorAll("[data-action='toggle-data-sync-task']").forEach((button) => button.addEventListener("click", async () => {
    try { await updateDataSyncTaskStatus(button.dataset.taskId, button.dataset.nextStatus); await refresh(rerender); } catch (caught) { error = caught.message; rerender(); }
  }));
  document.querySelectorAll("[data-action='create-data-sync-batch']").forEach((button) => button.addEventListener("click", async () => {
    try { await createDataSyncBatch(button.dataset.taskId, { syncMode: button.dataset.syncMode }); await refresh(rerender); } catch (caught) { error = caught.message; rerender(); }
  }));
  document.querySelectorAll("[data-action='preview-erp-data-sync']").forEach((button) => button.addEventListener("click", async () => {
    const form = document.querySelector("#erp-data-sync-form");
    const syncMode = button.dataset.syncMode;
    const requestStart = syncMode === "full" ? form?.elements.requestStart?.value : "";
    const requestEnd = form?.elements.requestEnd?.value;
    const platform = form?.elements.platform?.value;
    const shopId = form?.elements.shopId?.value;
    loading = true; error = ""; rerender();
    try {
      syncPreview = await previewErpGoodsDataSync(button.dataset.taskId, { syncMode, requestStart, requestEnd });
      await refresh(rerender);
    } catch (caught) { loading = false; error = caught.message; rerender(); }
  }));
  document.querySelectorAll("[data-action='load-erp-data-sync-preview']").forEach((button) => button.addEventListener("click", async () => {
    try { syncPreview = await loadErpGoodsDataSyncPreview(button.dataset.batchId); rerender(); } catch (caught) { error = caught.message; rerender(); }
  }));
  document.querySelector("#wangdian-shop-mapping-form")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { await saveWangdianShopMapping({ wangdianShopNo: form.get("wangdianShopNo"), shopId: form.get("shopId") }); await refresh(rerender); } catch (caught) { error = caught.message; rerender(); }
  });
  document.querySelectorAll("[data-action='preview-platform-data-sync']").forEach((button) => button.addEventListener("click", async () => {
    const form = document.querySelector("#platform-data-sync-form");
    const syncMode = button.dataset.syncMode;
    const requestStart = syncMode === "full" ? form?.elements.requestStart?.value : "";
    const requestEnd = form?.elements.requestEnd?.value;
    loading = true; error = ""; rerender();
    try { platformSyncPreview = await previewPlatformGoodsDataSync(button.dataset.taskId, { syncMode, requestStart, requestEnd, scope: { shops: shopId ? [shopId] : [], platforms: platform ? [platform] : [] } }); await refresh(rerender); } catch (caught) { loading = false; error = caught.message; rerender(); }
  }));
  document.querySelectorAll("[data-action='load-platform-data-sync-preview']").forEach((button) => button.addEventListener("click", async () => {
    try { platformSyncPreview = await loadPlatformGoodsDataSyncPreview(button.dataset.batchId); rerender(); } catch (caught) { error = caught.message; rerender(); }
  }));
  document.querySelector("[data-action='commit-platform-data-sync']")?.addEventListener("click", async (event) => {
    const batchId = event.currentTarget.dataset.batchId;
    loading = true; error = ""; rerender();
    try { await commitPlatformGoodsDataSync(batchId); platformSyncPreview = null; await refresh(rerender); } catch (caught) { loading = false; error = caught.message; rerender(); }
  });
  document.querySelectorAll("[data-action='preview-inventory-data-sync']").forEach((button) => button.addEventListener("click", async () => {
    const form = document.querySelector("#inventory-data-sync-form");
    const syncMode = button.dataset.syncMode;
    const list = (name) => String(form?.elements[name]?.value || "").split(",").map((item) => item.trim()).filter(Boolean);
    loading = true; error = ""; rerender();
    try {
      inventorySyncPreview = await previewInventoryDataSync(button.dataset.taskId, { syncMode, requestStart: syncMode === "full" ? form?.elements.requestStart?.value : "", requestEnd: form?.elements.requestEnd?.value, businessDate: form?.elements.businessDate?.value, scope: { specNos: list("specNos"), warehouseIds: list("warehouseIds") } });
      await refresh(rerender);
    } catch (caught) { loading = false; error = caught.message; rerender(); }
  }));
  document.querySelectorAll("[data-action='load-inventory-data-sync-preview']").forEach((button) => button.addEventListener("click", async () => {
    try { inventorySyncPreview = await loadInventoryDataSyncPreview(button.dataset.batchId); rerender(); } catch (caught) { error = caught.message; rerender(); }
  }));
  document.querySelector("[data-action='commit-inventory-data-sync']")?.addEventListener("click", async (event) => {
    const batchId = event.currentTarget.dataset.batchId;
    loading = true; error = ""; rerender();
    try { await commitInventoryDataSync(batchId); inventorySyncPreview = null; await refresh(rerender); } catch (caught) { loading = false; error = caught.message; rerender(); }
  });
  document.querySelector("[data-action='commit-erp-data-sync']")?.addEventListener("click", async (event) => {
    const batchId = event.currentTarget.dataset.batchId;
    loading = true; error = ""; rerender();
    try {
      await commitErpGoodsDataSync(batchId);
      syncPreview = null;
      await refresh(rerender);
    } catch (caught) { loading = false; error = caught.message; rerender(); }
  });
}
