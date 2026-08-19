import { commitErpGoodsDataSync, commitInventoryDataSync, commitPlatformGoodsDataSync, commitPlatformGoodsExcelDataSync, createDataSyncBatch, discoverWangdianPlatformShops, loadDataSyncCenter, loadErpGoodsDataSyncPreview, loadInventoryDataSyncPreview, loadPlatformGoodsDataSyncPreview, loadPlatformGoodsExcelDataSyncPreview, loadWangdianShopDiscoveryBatch, previewErpGoodsDataSync, previewInventoryDataSync, previewPlatformGoodsDataSync, previewPlatformGoodsExcelDataSync, resumeWangdianShopDiscoveryBatch, saveWangdianShopMapping, updateDataSyncTaskStatus } from "./appState.js";

let loading = false;
let error = "";
let result = null;
let syncPreview = null;
let platformSyncPreview = null;
let inventorySyncPreview = null;
let platformGoodsExcelPreview = null;
let discoveredWangdianShops = null;
let shopDiscoveryPolling = false;

async function pollShopDiscoveryBatch(batchId, rerender) {
  if (!batchId || shopDiscoveryPolling) return;
  shopDiscoveryPolling = true;
  try {
    while (true) {
      const response = await loadWangdianShopDiscoveryBatch(batchId);
      discoveredWangdianShops = response.batch;
      rerender();
      if (!["waiting", "running"].includes(discoveredWangdianShops.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  } catch (caught) {
    error = caught.message || "店铺识别进度读取失败。";
    rerender();
  } finally {
    shopDiscoveryPolling = false;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]);
}

function renderDataSyncCenter() {
  if (!result) return "";
  const taskStatus = { enabled: "已启用", paused: "已暂停" };
  const batchStatus = { queued: "等待", waiting: "等待", running: "执行中", interrupted: "已中断·可续跑", preview_ready: "待确认", validated: "待确认", superseded: "历史预览", succeeded: "成功", completed: "成功", completed_with_exceptions: "部分完成", partial: "部分成功", failed: "失败" };
  const erpTask = (result.tasks ?? []).find((task) => task.taskCode === "erp_goods");
  const platformTask = (result.tasks ?? []).find((task) => task.taskCode === "wangdian_platform_goods");
  const inventoryTask = (result.tasks ?? []).find((task) => task.taskCode === "wangdian_inventory");
  const salesFactTask = (result.tasks ?? []).find((task) => task.taskCode === "sales_fact_excel_import");
  const platformGoodsExcelTask = (result.tasks ?? []).find((task) => task.taskCode === "platform_goods_excel_import");
  const salesDailyBatches = result.salesDailyBatches ?? [];
  const latestSalesDailyBatch = result.latestSalesDailyBatch ?? null;
  const today = new Date().toLocaleDateString("sv-SE");
  const taskExceptionCount = (task) => (result.exceptions ?? []).filter((item) => item.taskId === task.id || item.taskCode === task.taskCode).length;
  const successfulBatchCount = (batch) => Math.max(0, Number(batch.totalCount ?? 0) - Number(batch.exceptionCount ?? 0));
  const technicalDetails = (items) => `<details class="data-center-technical-details"><summary>查看技术详情</summary>${items.filter((item) => item[1] !== undefined && item[1] !== null && item[1] !== "").map(([label, value]) => `<p><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></p>`).join("")}</details>`;
  const renderBatchAction = (batch) => batch.status === "interrupted" && ["erp_goods", "wangdian_platform_goods", "wangdian_inventory"].includes(batch.taskCode)
    ? `<button class="text-button" data-action="resume-data-sync-batch" data-task-id="${escapeHtml(batch.taskId)}" data-task-code="${escapeHtml(batch.taskCode)}" data-batch-id="${escapeHtml(batch.id)}">继续执行</button>`
    : ["preview_ready", "superseded"].includes(batch.status) && batch.sourceBatchType === "erp_import_batch"
      ? `<button class="text-button" data-action="load-erp-data-sync-preview" data-batch-id="${escapeHtml(batch.id)}">查看详情</button>`
      : ["preview_ready", "superseded"].includes(batch.status) && batch.sourceBatchType === "wangdian_platform_goods_sync"
        ? `<button class="text-button" data-action="load-platform-data-sync-preview" data-batch-id="${escapeHtml(batch.id)}">查看详情</button>`
        : ["preview_ready", "superseded"].includes(batch.status) && batch.sourceBatchType === "wangdian_inventory_sync"
          ? `<button class="text-button" data-action="load-inventory-data-sync-preview" data-batch-id="${escapeHtml(batch.id)}">查看详情</button>`
          : ["preview_ready", "superseded"].includes(batch.status) && batch.sourceBatchType === "platform_goods_excel_import"
            ? `<button class="text-button" data-action="load-platform-goods-excel" data-batch-id="${escapeHtml(batch.id)}">查看详情</button>`
            : ["connection_sales_import", "sales_daily_preview"].includes(batch.sourceBatchType)
              ? technicalDetails([["历史批次ID", batch.id], ["文件", batch.fileName], ["状态", batchStatus[batch.status] || batch.status]])
              : "—";
  return `<div class="data-sync-center">
    <div class="data-center-overview">
      <div><span>同步任务</span><strong>${result.counts?.taskCount ?? 0}</strong></div>
      <div><span>已启用</span><strong>${result.counts?.enabledTaskCount ?? 0}</strong></div>
      <div><span>执行中/等待</span><strong>${result.counts?.activeBatchCount ?? 0}</strong></div>
      <div><span>待处理异常</span><strong>${result.counts?.openExceptionCount ?? 0}</strong></div>
    </div>
    <section><h2>同步任务</h2><div class="table-wrap"><table class="data-table"><thead><tr><th>任务名称</th><th>当前状态</th><th>最近成功</th><th>下次执行</th><th>异常数量</th><th>操作</th></tr></thead><tbody>
      ${(result.tasks ?? []).map((task) => `<tr><td><strong>${escapeHtml(task.name)}</strong></td><td><span class="status-badge">${taskStatus[task.status] || "状态待确认"}</span></td><td>${task.taskCode === "sales_fact_excel_import" ? formatDate(latestSalesDailyBatch?.syncedAt) : formatDate(task.lastSuccessAt)}</td><td>${formatDate(task.nextRunAt)}</td><td>${task.taskCode === "sales_fact_excel_import" ? latestSalesDailyBatch?.exceptionCount ?? 0 : taskExceptionCount(task)}</td><td>${task.taskCode === "sales_fact_excel_import" ? "仅状态查看" : `<button class="text-button" data-action="toggle-data-sync-task" data-task-id="${escapeHtml(task.id)}" data-next-status="${task.status === "enabled" ? "paused" : "enabled"}">${task.status === "enabled" ? "暂停" : "启用"}</button>${task.status === "enabled" && !["erp_goods", "wangdian_platform_goods", "wangdian_inventory", "platform_goods_excel_import"].includes(task.taskCode) ? `<button class="text-button" data-action="create-data-sync-batch" data-task-id="${escapeHtml(task.id)}" data-sync-mode="${escapeHtml(task.defaultSyncMode)}">立即执行</button>` : ""}`}</td></tr>`).join("")}
    </tbody></table></div></section>
    ${erpTask ? `<section><h2>ERP货品同步执行</h2>${erpTask.status !== "enabled" ? `<div class="data-center-notice">ERP货品同步任务当前已暂停。启用后才可生成全量或增量预览；启用自动调度前请先完成一次全量同步。</div>` : `<form id="erp-data-sync-form" class="data-center-filter">
      <label><span>开始时间</span><input name="requestStart" type="datetime-local" value="2021-01-01T00:00" /></label>
      <label><span>结束时间</span><input name="requestEnd" type="datetime-local" value="${today}T23:59" /></label>
      <button type="button" class="secondary-button" data-action="preview-erp-data-sync" data-sync-mode="full" data-task-id="${escapeHtml(erpTask.id)}">生成全量预览</button>
      <button type="button" class="primary-button" data-action="preview-erp-data-sync" data-sync-mode="incremental" data-task-id="${escapeHtml(erpTask.id)}">执行增量预览</button>
    </form>`}
    ${syncPreview ? `<div class="data-center-notice"><strong>${syncPreview.noChange ? "已同步，无变化" : syncPreview.isCurrent === false ? "历史预览" : "当前有效预览"}</strong><p>${syncPreview.noChange ? escapeHtml(syncPreview.message || "旺店通商品档案已同步，当期无新增或变更。") : `ERP货品 ${syncPreview.summary?.validGoods ?? 0}；SKU总数 ${syncPreview.summary?.total ?? 0}；可导入 ${syncPreview.summary?.importable ?? 0}；异常跳过 ${syncPreview.summary?.skipped ?? 0}；警告 ${syncPreview.summary?.warningCount ?? syncPreview.summary?.warnings ?? 0}。`}</p>${syncPreview.noChange ? `<span>本次无需确认写入，商品档案和SKU数据未发生变化。</span>` : syncPreview.isCurrent === false ? `<span>该预览已被更新结果替代，仅供查看。</span>` : `<span>本次同步将导入 ${syncPreview.summary?.importable ?? 0} 个SKU，隔离 ${syncPreview.summary?.skipped ?? 0} 个异常SKU；不会创建产品或修改产品映射。</span><button class="primary-button" data-action="commit-erp-data-sync" data-batch-id="${escapeHtml(syncPreview.dataSyncBatch?.id)}">确认提交当前预览</button>`}${technicalDetails([["批次ID", syncPreview.dataSyncBatch?.id], ["预览版本", syncPreview.summary?.previewVersion]])}</div>` : ""}</section>` : ""}
    ${platformTask ? `<section><h2>平台货品关系同步执行</h2>${platformTask.status !== "enabled" ? `<div class="data-center-notice">平台货品关系同步任务当前已暂停。请先维护旺店通店铺映射并完成一次全量同步，再启用自动调度。</div>` : `<form id="platform-data-sync-form" class="data-center-filter">
      <label><span>开始时间</span><input name="requestStart" type="datetime-local" value="2021-01-01T00:00" /></label>
      <label><span>结束时间</span><input name="requestEnd" type="datetime-local" value="${today}T23:59" /></label>
      <label><span>平台范围</span><select name="platform"><option value="">全部平台</option>${[...new Set((result.salesShops ?? []).map((shop) => shop.platform))].map((platform) => `<option value="${escapeHtml(platform)}">${escapeHtml(platform)}</option>`).join("")}</select></label>
      <label><span>店铺范围</span><select name="shopId"><option value="">全部店铺</option>${(result.salesShops ?? []).map((shop) => `<option value="${escapeHtml(shop.id)}">${escapeHtml(`${shop.platform} · ${shop.displayName || shop.shopName}`)}</option>`).join("")}</select></label>
      <button type="button" class="secondary-button" data-action="preview-platform-data-sync" data-sync-mode="full" data-task-id="${escapeHtml(platformTask.id)}">生成全量预览</button>
      <button type="button" class="primary-button" data-action="preview-platform-data-sync" data-sync-mode="incremental" data-task-id="${escapeHtml(platformTask.id)}">执行增量预览</button>
    </form>`}
    <form id="wangdian-shop-mapping-form" class="data-center-filter"><input name="wangdianShopNo" placeholder="旺店通店铺编号" required /><select name="shopId" required><option value="">选择系统店铺</option>${(result.salesShops ?? []).map((shop) => `<option value="${escapeHtml(shop.id)}">${escapeHtml(`${shop.platform} · ${shop.displayName || shop.shopName}`)}</option>`).join("")}</select><button class="secondary-button" type="submit">保存店铺映射</button><button class="text-button" type="button" data-action="discover-wangdian-shops">只读识别店铺编号</button></form>
    ${(result.wangdianShopMappings ?? []).length ? `<p>已映射：${result.wangdianShopMappings.map((item) => escapeHtml(`${item.wangdianShopNo} → ${item.platform} · ${item.displayName || item.shopName}`)).join("；")}</p>` : `<p class="form-note">尚未配置旺店通店铺映射。</p>`}
    ${discoveredWangdianShops ? `<div class="data-center-notice"><strong>旺店通店铺识别</strong><p>状态：${escapeHtml({waiting:"等待",running:"执行中",completed:"已完成",failed:"失败"}[discoveredWangdianShops.status] || discoveredWangdianShops.status)}；目标：${escapeHtml(`${discoveredWangdianShops.platform || "—"} · ${discoveredWangdianShops.displayName || discoveredWangdianShops.shopName || "—"}`)}；已读取 ${discoveredWangdianShops.readRows ?? 0} 条。</p>${discoveredWangdianShops.errorMessage ? `<span>${escapeHtml(discoveredWangdianShops.errorMessage)}</span><button class="text-button" data-action="resume-shop-discovery" data-batch-id="${escapeHtml(discoveredWangdianShops.id)}">继续识别</button>` : ""}<div class="table-wrap"><table class="data-table"><thead><tr><th>排名</th><th>店铺编号</th><th>返回商品数</th><th>匹配商品数</th><th>匹配率</th><th>命中商品样本</th><th>映射状态</th></tr></thead><tbody>${(discoveredWangdianShops.candidates ?? []).map((item, index) => `<tr><td>${index + 1}</td><td><strong>${escapeHtml(item.shopNo)}</strong></td><td>${item.returnedGoodsCount ?? 0}</td><td>${item.matchedGoodsCount ?? 0}</td><td>${number((item.matchRate ?? 0) * 100, 2)}%</td><td>${escapeHtml((item.matchedPlatformGoodsIds ?? []).join("、") || "—")}</td><td>${item.mapping ? `已映射至 ${escapeHtml(item.mapping.displayName || item.mapping.shopName)}` : "未映射"}</td></tr>`).join("") || `<tr><td colspan="7">识别中，候选结果正在累计。</td></tr>`}</tbody></table></div></div>` : ""}
    ${platformSyncPreview ? `<div class="data-center-notice"><strong>${platformSyncPreview.isCurrent === false ? "历史预览" : "当前有效预览"}</strong><p>原始行 ${platformSyncPreview.summary?.total ?? 0}；有效匹配 ${platformSyncPreview.summary?.matched ?? 0}；新增 ${platformSyncPreview.summary?.created ?? 0}；更新 ${platformSyncPreview.summary?.updated ?? 0}；异常 ${platformSyncPreview.summary?.exceptionCount ?? 0}。</p>${platformSyncPreview.isCurrent === false ? `<span>该预览已被更新结果替代，仅供查看。</span>` : `<button class="primary-button" data-action="commit-platform-data-sync" data-batch-id="${escapeHtml(platformSyncPreview.dataSyncBatch?.id)}" ${platformSyncPreview.summary?.canCommit === false ? "disabled" : ""}>确认提交当前预览</button>`}${technicalDetails([["批次ID", platformSyncPreview.dataSyncBatch?.id]])}</div>` : ""}</section>` : ""}
    ${inventoryTask ? `<section><h2>库存同步执行</h2>${inventoryTask.status !== "enabled" ? `<div class="data-center-notice">库存同步任务当前已暂停。首次全量同步并确认库存口径后，再启用自动调度。</div>` : `<form id="inventory-data-sync-form" class="data-center-filter">
      <label><span>业务日期</span><input name="businessDate" type="date" value="${today}" /></label>
      <label><span>开始时间</span><input name="requestStart" type="datetime-local" value="${today}T00:00" /></label>
      <label><span>结束时间</span><input name="requestEnd" type="datetime-local" value="${today}T23:59" /></label>
      <input name="specNos" placeholder="SKU范围（逗号分隔，空为全部）" />
      <input name="warehouseIds" placeholder="仓库ID范围（逗号分隔，空为全部）" />
      <button type="button" class="secondary-button" data-action="preview-inventory-data-sync" data-sync-mode="full" data-task-id="${escapeHtml(inventoryTask.id)}">生成全量预览</button>
      <button type="button" class="primary-button" data-action="preview-inventory-data-sync" data-sync-mode="incremental" data-task-id="${escapeHtml(inventoryTask.id)}">执行增量预览</button>
    </form>`}
    ${inventorySyncPreview ? `<div class="data-center-notice"><strong>${inventorySyncPreview.isCurrent === false ? "历史预览" : "当前有效预览"}</strong><p>业务日期 ${escapeHtml(inventorySyncPreview.summary?.businessDate)}；原始行 ${inventorySyncPreview.summary?.total ?? 0}；有效仓库事实 ${inventorySyncPreview.summary?.matched ?? 0}；新增 ${inventorySyncPreview.summary?.created ?? 0}；更新 ${inventorySyncPreview.summary?.updated ?? 0}；异常 ${inventorySyncPreview.summary?.exceptionCount ?? 0}。</p>${inventorySyncPreview.isCurrent === false ? `<span>该预览已被更新结果替代，仅供查看。</span>` : `<button class="primary-button" data-action="commit-inventory-data-sync" data-batch-id="${escapeHtml(inventorySyncPreview.dataSyncBatch?.id)}">确认提交当前预览</button>`}${technicalDetails([["批次ID", inventorySyncPreview.dataSyncBatch?.id]])}</div>` : ""}</section>` : ""}
      ${platformGoodsExcelTask ? `<section id="platform-goods-excel"><h2>平台货品关系导入</h2><p>上传全量平台货品Excel；系统按文件内店铺字段精确匹配现有店铺，再以货品ID、规格ID和ERP SKU编码建立V2关系。</p><form id="platform-goods-excel-form" class="data-center-filter"><label><span>平台货品Excel</span><input name="file" type="file" accept=".xlsx,.xls" required /></label><button class="primary-button" type="submit">上传全文件并生成预览</button></form>
      ${platformGoodsExcelPreview ? `<div class="data-center-notice"><strong>${platformGoodsExcelPreview.isCurrent ? "当前有效预览" : "历史预览"}</strong><p>文件 ${escapeHtml(platformGoodsExcelPreview.summary?.fileName || "—")}；周期 ${escapeHtml(platformGoodsExcelPreview.summary?.periodStart || "—")} 至 ${escapeHtml(platformGoodsExcelPreview.summary?.periodEnd || "—")}。</p><p>文件店铺 ${platformGoodsExcelPreview.summary?.sourceShopCount ?? 0}；成功覆盖店铺 ${platformGoodsExcelPreview.summary?.matchedShopCount ?? 0}；平台SKU ${platformGoodsExcelPreview.summary?.totalPlatformSkus ?? 0}；可关联 ${platformGoodsExcelPreview.summary?.linkable ?? 0}；已关联 ${platformGoodsExcelPreview.summary?.alreadyLinked ?? 0}；组合装 ${platformGoodsExcelPreview.summary?.bundleCount ?? 0}；异常 ${platformGoodsExcelPreview.summary?.exceptionCount ?? 0}。</p>${platformGoodsExcelPreview.isCurrent ? `<button class="primary-button" data-action="commit-platform-goods-excel" data-batch-id="${escapeHtml(platformGoodsExcelPreview.dataSyncBatch?.id)}">确认补充ERP SKU关系</button>` : ""}${technicalDetails([["批次ID", platformGoodsExcelPreview.dataSyncBatch?.id], ["文件SHA", platformGoodsExcelPreview.summary?.fileHash]])}</div>` : ""}</section>` : ""}
    ${salesFactTask ? `<section><h2>链接利润表同步状态</h2><p>上传入口已统一至<a href="#connectionCenter/data-import">链接中心 → 数据更新</a>；此处仅展示日报导入状态。</p><div class="table-wrap"><table class="data-table"><thead><tr><th>最近同步时间</th><th>文件</th><th>批次状态</th><th>成功数量</th><th>异常数量</th><th>操作</th></tr></thead><tbody>${salesDailyBatches.length ? salesDailyBatches.map((batch) => `<tr><td>${formatDate(batch.syncedAt)}</td><td>${escapeHtml(batch.fileName || "—")}</td><td>${batchStatus[batch.status] || "状态待确认"}</td><td>${batch.successfulCount ?? 0}</td><td>${batch.exceptionCount ?? 0}</td><td><details class="data-center-technical-details"><summary>查看详情</summary><p><span>批次ID</span><strong>${escapeHtml(batch.id)}</strong></p><p><span>数据周期</span><strong>${escapeHtml(batch.periodStart || "—")} 至 ${escapeHtml(batch.periodEnd || "—")}</strong></p><p><span>总行数</span><strong>${batch.totalCount ?? 0}</strong></p><p><span>新增</span><strong>${batch.insertedCount ?? 0}</strong></p><p><span>重复跳过</span><strong>${batch.skippedCount ?? 0}</strong></p><p><span>待确认更新</span><strong>${batch.updatePendingCount ?? 0}</strong></p><p><span>关系待治理</span><strong>${batch.governanceCount ?? 0}</strong></p></details></td></tr>`).join("") : `<tr><td colspan="6">暂无链接利润表日报批次</td></tr>`}</tbody></table></div></section>` : ""}
    <section><h2>同步历史</h2><div class="table-wrap"><table class="data-table"><thead><tr><th>执行时间</th><th>类型</th><th>状态</th><th>成功数量</th><th>异常数量</th><th>操作</th></tr></thead><tbody>${(result.batches ?? []).length ? result.batches.map((batch) => `<tr><td>${formatDate(batch.startedAt || batch.createdAt)}</td><td><strong>${escapeHtml(batch.taskName)}</strong><small>${batch.triggerMode === "automatic" ? "自动" : "手动"} · ${batch.syncMode === "full" ? "全量" : "增量"}</small></td><td>${batchStatus[batch.status] || "状态待确认"}</td><td>${successfulBatchCount(batch)}</td><td>${batch.exceptionCount ?? 0}</td><td>${renderBatchAction(batch)}</td></tr>`).join("") : `<tr><td colspan="6">暂无同步记录</td></tr>`}</tbody></table></div></section>
    <section><h2>异常中心</h2><div class="table-wrap"><table class="data-table"><thead><tr><th>异常类型</th><th>数量</th><th>状态</th><th>处理入口</th></tr></thead><tbody>${(result.exceptions ?? []).length ? Object.values((result.exceptions ?? []).reduce((groups, item) => { const key = `${item.exceptionType}::${item.status}`; groups[key] ||= { ...item, count: 0, items: [] }; groups[key].count += 1; groups[key].items.push(item); return groups; }, {})).map((item) => `<tr><td><strong>${escapeHtml(item.exceptionType)}</strong><small>${escapeHtml(item.taskName || "数据同步")}</small></td><td>${item.count}</td><td>${item.status === "open" ? "待处理" : "已处理"}</td><td><details><summary>查看异常</summary>${item.items.map((entry) => `<p>${escapeHtml(entry.message || "未提供异常说明")}<small>${formatDate(entry.createdAt)}</small></p>`).join("")}</details></td></tr>`).join("") : `<tr><td colspan="4">当前没有同步异常</td></tr>`}</tbody></table></div></section>
  </div>`;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
}

export function renderAdminDataCenterPage() {
  return `<section class="data-center-page">
    <div class="section-heading"><div><h1>管理员数据中心</h1><p>统一管理外部数据同步任务、执行批次、日志与技术异常。</p></div><a class="secondary-button" href="#settings">返回系统设置</a></div>
    ${loading ? `<div class="form-note">正在读取同步状态…</div>` : error ? `<div class="form-error">${escapeHtml(error)}</div>` : renderDataSyncCenter()}
  </section>`;
}

async function refresh(rerender) {
  loading = true; error = ""; rerender();
  try {
    result = await loadDataSyncCenter();
  } catch (caught) {
    error = caught.message || "数据中心读取失败。";
  }
  loading = false; rerender();
}

export function bindAdminDataCenterPageEvents(rerender) {
  if (!result && !loading) refresh(rerender);
  if (result?.latestShopDiscoveryBatch?.id && !discoveredWangdianShops && !shopDiscoveryPolling) pollShopDiscoveryBatch(result.latestShopDiscoveryBatch.id, rerender);
  document.querySelectorAll("[data-action='toggle-data-sync-task']").forEach((button) => button.addEventListener("click", async () => {
    try { await updateDataSyncTaskStatus(button.dataset.taskId, button.dataset.nextStatus); await refresh(rerender); } catch (caught) { error = caught.message; rerender(); }
  }));
  document.querySelectorAll("[data-action='create-data-sync-batch']").forEach((button) => button.addEventListener("click", async () => {
    try { await createDataSyncBatch(button.dataset.taskId, { syncMode: button.dataset.syncMode }); await refresh(rerender); } catch (caught) { error = caught.message; rerender(); }
  }));
  document.querySelectorAll("[data-action='resume-data-sync-batch']").forEach((button) => button.addEventListener("click", async () => {
    loading = true; error = ""; rerender();
    try {
      const options = { resumeBatchId: button.dataset.batchId };
      if (button.dataset.taskCode === "erp_goods") syncPreview = await previewErpGoodsDataSync(button.dataset.taskId, options);
      else if (button.dataset.taskCode === "wangdian_platform_goods") platformSyncPreview = await previewPlatformGoodsDataSync(button.dataset.taskId, options);
      else if (button.dataset.taskCode === "wangdian_inventory") inventorySyncPreview = await previewInventoryDataSync(button.dataset.taskId, options);
      await refresh(rerender);
    } catch (caught) { loading = false; error = caught.message; rerender(); }
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
  document.querySelector("[data-action='discover-wangdian-shops']")?.addEventListener("click", async () => {
    const form = document.querySelector("#platform-data-sync-form");
    const mappingForm = document.querySelector("#wangdian-shop-mapping-form");
    try {
      const response = await discoverWangdianPlatformShops({ startTime: form?.elements.requestStart?.value, endTime: form?.elements.requestEnd?.value, shopId: mappingForm?.elements.shopId?.value });
      discoveredWangdianShops = response.batch;
      rerender();
      pollShopDiscoveryBatch(discoveredWangdianShops.id, rerender);
    } catch (caught) { error = caught.message; rerender(); }
  });
  document.querySelector("[data-action='resume-shop-discovery']")?.addEventListener("click", async (event) => {
    try {
      const response = await resumeWangdianShopDiscoveryBatch(event.currentTarget.dataset.batchId);
      discoveredWangdianShops = response.batch;
      rerender();
      pollShopDiscoveryBatch(discoveredWangdianShops.id, rerender);
    } catch (caught) { error = caught.message; rerender(); }
  });
  document.querySelectorAll("[data-action='preview-platform-data-sync']").forEach((button) => button.addEventListener("click", async () => {
    const form = document.querySelector("#platform-data-sync-form");
    const syncMode = button.dataset.syncMode;
    const requestStart = syncMode === "full" ? form?.elements.requestStart?.value : "";
    const requestEnd = form?.elements.requestEnd?.value;
    const platform = form?.elements.platform?.value?.trim() || "";
    const shopId = form?.elements.shopId?.value?.trim() || "";
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
  document.querySelector("#platform-goods-excel-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.elements.file.files?.[0];
    if (!file) { error = "请选择平台货品Excel文件。"; rerender(); return; }
    const task = (result.tasks ?? []).find((item) => item.taskCode === "platform_goods_excel_import");
    loading = true; error = ""; rerender();
    try {
      platformGoodsExcelPreview = await previewPlatformGoodsExcelDataSync(task.id, { file });
      await refresh(rerender);
    } catch (caught) { loading = false; error = caught.message; rerender(); }
  });
  document.querySelectorAll("[data-action='load-platform-goods-excel']").forEach((button) => button.addEventListener("click", async () => {
    try { platformGoodsExcelPreview = await loadPlatformGoodsExcelDataSyncPreview(button.dataset.batchId); rerender(); } catch (caught) { error = caught.message; rerender(); }
  }));
  document.querySelector("[data-action='commit-platform-goods-excel']")?.addEventListener("click", async (event) => {
    loading = true; error = ""; rerender();
    try { await commitPlatformGoodsExcelDataSync(event.currentTarget.dataset.batchId); platformGoodsExcelPreview = null; await refresh(rerender); } catch (caught) { loading = false; error = caught.message; rerender(); }
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
