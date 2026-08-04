import {
  approveFinanceEntry, commitFinanceBill, createFinanceRule, deleteFinanceRule, getCurrentUser, loadFinanceAnalysis,
  loadFinanceEntries, loadFinanceImportBatches, loadFinanceRules, loadFinanceStatement, uploadFinanceBill,
} from "./appState.js";
import { hasPermission } from "./permissions.js?v=20260705-state-singleton1";

let tab = "overview";
let loading = false;
let error = "";
let statement = null;
let analysis = null;
let entries = [];
let batches = [];
let rules = [];
let preview = null;
let filters = { periodType: "month", startDate: "", endDate: "" };

function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]); }
function number(value, digits = 2) { return value === null || value === undefined ? "—" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: digits }); }
function money(value) { return value === null || value === undefined ? "—" : `¥${number(value)}`; }
function percent(value) { return value === null || value === undefined ? "—" : `${(Number(value) * 100).toFixed(1)}%`; }
function typeName(type) { return ({ income: "收入", refund: "退款", cost: "成本", expense: "费用" })[type] || type; }
function canManage() { return hasPermission(getCurrentUser(), "finance.manage"); }
function canApprove() { return hasPermission(getCurrentUser(), "finance.approve"); }

function summaryCards(summary = {}) {
  return `<div class="finance-summary"><article><span>实际收入</span><strong>${money(summary.income)}</strong><small>销售 ${money(summary.grossIncome)} · 退款 ${money(summary.refunds)}</small></article><article><span>商品成本</span><strong>${money(summary.cost)}</strong><small>毛利 ${money(summary.grossProfit)}</small></article><article><span>经营费用</span><strong>${money(summary.expense)}</strong><small>独立费用事实</small></article><article class="${summary.netProfit < 0 ? "is-risk" : ""}"><span>净利润</span><strong>${money(summary.netProfit)}</strong><small>利润率 ${percent(summary.profitMargin)}</small></article></div>`;
}

function statementTable() {
  const periods = statement?.periods || [];
  return `<section class="finance-panel"><header><h2>利润表</h2><p>收入 - 商品成本 - 经营费用 = 净利润</p></header><div class="table-wrap"><table class="data-table"><thead><tr><th>周期</th><th>实际收入</th><th>商品成本</th><th>毛利</th><th>经营费用</th><th>净利润</th><th>利润率</th></tr></thead><tbody>${periods.length ? periods.map((row) => `<tr><td>${escapeHtml(row.period)}</td><td>${money(row.income)}</td><td>${money(row.cost)}</td><td>${money(row.grossProfit)}</td><td>${money(row.expense)}</td><td>${money(row.netProfit)}</td><td>${percent(row.profitMargin)}</td></tr>`).join("") : `<tr><td colspan="7" class="empty-cell">尚无已确认财务数据</td></tr>`}</tbody></table></div></section>`;
}

function analysisList(title, items) {
  return `<section class="finance-panel"><header><h2>${escapeHtml(title)}</h2></header><div class="finance-ranking">${items?.length ? items.slice(0, 20).map((row, i) => `<article><span>${i + 1}</span><strong>${escapeHtml(row.name)}</strong><em>${money(row.netProfit)}</em><small>收入 ${money(row.income)} · 利润率 ${percent(row.profitMargin)}</small></article>`).join("") : `<div class="empty-state compact">暂无关联财务数据</div>`}</div></section>`;
}

function renderOverview() {
  return `${summaryCards(statement?.summary)}${statementTable()}<div class="finance-analysis-grid">${analysisList("产品利润", analysis?.products)}${analysisList("链接利润", analysis?.links)}${analysisList("平台利润", analysis?.platforms)}</div>`;
}

function renderExpenses() {
  const rows = entries.filter((item) => item.entryType === "expense");
  return `<section class="finance-panel"><header><h2>费用管理</h2><p>平台、广告、推广、人工及管理费用</p></header><div class="table-wrap"><table class="data-table"><thead><tr><th>日期</th><th>分类</th><th>摘要</th><th>平台</th><th>金额</th><th>状态</th>${canApprove() ? "<th>操作</th>" : ""}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr><td>${escapeHtml(row.businessDate)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.description || "—")}</td><td>${escapeHtml(row.platform || "—")}</td><td>${money(row.amount)}</td><td>${escapeHtml(row.status)}</td>${canApprove() ? `<td>${row.status === "approved" ? "已审批" : `<button class="text-button" data-approve-finance-entry="${escapeHtml(row.id)}">审批</button>`}</td>` : ""}</tr>`).join("") : `<tr><td colspan="${canApprove() ? 7 : 6}" class="empty-cell">暂无费用记录</td></tr>`}</tbody></table></div></section>`;
}

function renderImportTypeControl(row) {
  if (row.entryType) return escapeHtml(typeName(row.entryType));
  return `<select data-finance-entry-type="${row.rowNumber}"><option value="">请选择</option><option value="income">收入</option><option value="refund">退款</option><option value="cost">成本</option><option value="expense">费用</option></select>`;
}

function renderImportCategoryControl(row) {
  if (row.category) return escapeHtml(row.category);
  return `<input data-finance-category="${row.rowNumber}" placeholder="输入科目" />`;
}

function renderImport() {
  const rows = preview?.preview || [];
  return `<section class="finance-panel"><header><h2>账单导入</h2><p>Excel解析 → 科目匹配 → 人工确认 → 财务事实</p></header>${canManage() ? `<form data-finance-upload class="finance-upload"><input type="file" name="file" accept=".xlsx,.xls,.csv" required /><button class="primary-button">解析账单</button></form>` : `<p class="form-note">当前账号只有财务查看权限。</p>`}${preview ? `<div class="finance-import-summary"><strong>${escapeHtml(preview.fileName)}</strong><span>总行数 ${preview.totalRows}</span><span>已识别 ${preview.matchedRows}</span><span>待调整 ${preview.pendingRows}</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>行</th><th>日期</th><th>摘要</th><th>金额</th><th>类型</th><th>科目</th><th>关联</th></tr></thead><tbody>${rows.slice(0, 200).map((row) => `<tr><td>${row.rowNumber}</td><td>${escapeHtml(row.businessDate || "无效")}</td><td>${escapeHtml(row.description)}</td><td>${money(row.amount)}</td><td>${renderImportTypeControl(row)}</td><td>${renderImportCategoryControl(row)}</td><td>${row.productId ? "产品" : ""}${row.salesLinkId ? " 链接" : ""}${!row.productId && !row.salesLinkId ? "—" : ""}</td></tr>`).join("")}</tbody></table></div>${canManage() ? `<button class="primary-button" data-action="commit-finance-bill">确认入账</button>` : ""}` : ""}<h3>导入记录</h3><div class="finance-batches">${batches.map((item) => `<span>${escapeHtml(item.fileName)} · ${item.totalRows}行 · ${escapeHtml(item.status)}</span>`).join("") || "暂无"}</div></section>`;
}

function renderRules() {
  return `<section class="finance-panel"><header><h2>科目匹配规则</h2><p>按优先级匹配账单摘要关键词</p></header>${canManage() ? `<form data-finance-rule class="finance-rule-form"><input name="name" placeholder="规则名称" required /><input name="keywords" placeholder="关键词，逗号分隔" required /><select name="entryType"><option value="income">收入</option><option value="refund">退款</option><option value="cost">成本</option><option value="expense">费用</option></select><input name="category" placeholder="科目分类" required /><input name="priority" type="number" value="100" /><button class="primary-button">保存规则</button></form>` : ""}<div class="finance-rule-list">${rules.length ? rules.map((rule) => `<article><div><strong>${escapeHtml(rule.name)}</strong><small>${escapeHtml(rule.keywords.join("、"))}</small></div><span>${escapeHtml(typeName(rule.entryType))} · ${escapeHtml(rule.category)}</span>${canManage() ? `<button class="text-button danger-text" data-delete-finance-rule="${escapeHtml(rule.id)}">删除</button>` : ""}</article>`).join("") : `<div class="empty-state compact">暂无规则</div>`}</div></section>`;
}

export function renderFinanceCenterPage() {
  const content = loading ? `<div class="form-note">正在读取财务数据…</div>` : error ? `<div class="form-error">${escapeHtml(error)}</div>` : tab === "overview" || tab === "statement" ? renderOverview() : tab === "expenses" ? renderExpenses() : tab === "import" ? renderImport() : renderRules();
  return `<section class="finance-center-page"><div class="section-heading"><div><h1>财务中心</h1><p>经营利润分析中心：收入 - 成本 - 费用 = 利润</p></div></div><nav class="subtabs">${[["overview","财务首页"],["statement","利润表"],["expenses","费用管理"],["import","账单导入"],["rules","规则设置"]].map(([key,label]) => `<button class="${tab===key?"is-active":""}" data-finance-tab="${key}">${label}</button>`).join("")}</nav><form data-finance-filter class="data-center-filter"><input type="date" name="startDate" value="${filters.startDate}" /><input type="date" name="endDate" value="${filters.endDate}" /><select name="periodType"><option value="day" ${filters.periodType==="day"?"selected":""}>日报</option><option value="week" ${filters.periodType==="week"?"selected":""}>周报</option><option value="month" ${filters.periodType==="month"?"selected":""}>月报</option></select><button class="secondary-button">查询</button></form>${content}</section>`;
}

async function refresh(rerender) {
  loading = true; error = ""; rerender();
  try { const [s,a,e,b,r] = await Promise.all([loadFinanceStatement(filters),loadFinanceAnalysis(filters),loadFinanceEntries(filters),loadFinanceImportBatches(),loadFinanceRules()]); statement=s.statement; analysis=a.analysis; entries=e.items; batches=b.items; rules=r.items; }
  catch (caught) { error = caught.message || "财务中心读取失败。"; }
  loading = false; rerender();
}

export function bindFinanceCenterPageEvents(rerender) {
  if (!statement && !loading) refresh(rerender);
  document.querySelectorAll("[data-finance-tab]").forEach((button) => button.addEventListener("click", () => { tab=button.dataset.financeTab; rerender(); }));
  document.querySelector("[data-finance-filter]")?.addEventListener("submit", (event) => { event.preventDefault(); const form=new FormData(event.currentTarget); filters={periodType:String(form.get("periodType")),startDate:String(form.get("startDate")),endDate:String(form.get("endDate"))}; refresh(rerender); });
  document.querySelector("[data-finance-upload]")?.addEventListener("submit", async (event) => { event.preventDefault(); const file=event.currentTarget.elements.file.files[0]; if(!file)return; loading=true;rerender(); try{preview=(await uploadFinanceBill(file)).batch; batches=(await loadFinanceImportBatches()).items;}catch(caught){error=caught.message;} loading=false;rerender(); });
  document.querySelector("[data-action='commit-finance-bill']")?.addEventListener("click", async () => { const adjustments=(preview?.preview || []).filter((row) => !row.entryType || !row.category).map((row) => ({rowNumber:row.rowNumber,entryType:document.querySelector(`[data-finance-entry-type="${row.rowNumber}"]`)?.value || row.entryType,category:document.querySelector(`[data-finance-category="${row.rowNumber}"]`)?.value?.trim() || row.category})); try{await commitFinanceBill(preview.id, adjustments);preview=null;await refresh(rerender);}catch(caught){error=caught.message;rerender();} });
  document.querySelector("[data-finance-rule]")?.addEventListener("submit", async (event) => { event.preventDefault(); const form=Object.fromEntries(new FormData(event.currentTarget)); try{await createFinanceRule(form);rules=(await loadFinanceRules()).items;rerender();}catch(caught){error=caught.message;rerender();} });
  document.querySelectorAll("[data-delete-finance-rule]").forEach((button) => button.addEventListener("click", async () => { try{await deleteFinanceRule(button.dataset.deleteFinanceRule);rules=(await loadFinanceRules()).items;rerender();}catch(caught){error=caught.message;rerender();} }));
  document.querySelectorAll("[data-approve-finance-entry]").forEach((button) => button.addEventListener("click", async () => { try{await approveFinanceEntry(button.dataset.approveFinanceEntry);await refresh(rerender);}catch(caught){error=caught.message;rerender();} }));
}
