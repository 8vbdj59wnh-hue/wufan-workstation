import { registerUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js?v=20260802-module-boundary1";

export function renderLinkList({ items = [], total = 0, page = 1, totalPages = 1, search = "", filter = "all", loading = false, title = "我的链接", bodyHtml = "" } = {}) {
  if (bodyHtml) return `<section class="my-link-list-module company-link-list-module" data-module-key="link_list"><header><div><span>${escapeHtml(title)}</span><small>共 ${Number(total)} 条</small></div></header>${bodyHtml}</section>`;
  const filters = [["all", "全部"], ["better", "上涨"], ["worse", "风险"], ["followed", "我的关注"]];
  return `<section class="my-link-list-module" data-module-key="link_list"><header><div><span>我的链接</span><small>共 ${Number(total)} 条</small></div><form data-my-link-search><input type="search" name="search" value="${escapeHtml(search)}" placeholder="搜索链接名称、商品ID或店铺" aria-label="搜索我的链接" /><button type="submit" class="secondary-button">搜索</button></form></header><nav class="segmented-control" aria-label="我的链接筛选">${filters.map(([id, label]) => `<button type="button" class="${filter === id ? "active" : ""}" data-my-link-filter="${id}">${label}</button>`).join("")}</nav>${loading ? `<div class="empty-state">正在读取我的链接…</div>` : items.length ? `<div class="my-link-table-wrap"><table><thead><tr><th>链接</th><th>渠道</th><th>昨日销售额</th><th>增长</th><th>健康分</th><th>状态</th><th>待处理问题</th><th></th></tr></thead><tbody>${items.map((item) => `<tr><td><button type="button" class="my-link-list-identity" data-open-connection="${escapeHtml(item.id)}">${item.imageHtml}<span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.goodsId || "")}</small></span></button></td><td>${escapeHtml(item.channel)}</td><td>${escapeHtml(item.yesterdaySales)}</td><td><span class="my-link-trend is-${escapeHtml(item.trendClass)}">${escapeHtml(item.growth)}</span></td><td>${escapeHtml(item.health)}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.issueText)}</td><td><div class="my-link-list-actions"><button type="button" class="text-button" data-toggle-connection-follow="${escapeHtml(item.id)}" data-followed="${item.followed ? "true" : "false"}">${item.followed ? "取消关注" : "关注"}</button>${item.canJoinDiagnosis ? `<button type="button" class="text-button" data-join-diagnosis="${escapeHtml(item.id)}">加入诊断</button>` : ""}<button type="button" class="text-button" data-open-connection="${escapeHtml(item.id)}">查看详情</button></div></td></tr>`).join("")}</tbody></table></div><footer><span>第 ${Number(page)} / ${Number(totalPages)} 页</span><div><button type="button" class="secondary-button" data-my-link-page="${Number(page) - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button><button type="button" class="secondary-button" data-my-link-page="${Number(page) + 1}" ${page >= totalPages ? "disabled" : ""}>下一页</button></div></footer>` : `<div class="empty-state"><strong>暂无符合条件的链接</strong></div>`}</section>`;
}

registerUiModule({
  moduleKey: "link_list",
  name: "LinkList",
  domain: "business_links",
  description: "展示当前权限范围内的链接列表，并保留搜索、筛选、分页与详情入口。",
  render: renderLinkList,
  configSchema: { pageSize: "number", hideOwner: "boolean" },
  dependencies: ["BusinessLink", "QueryBusinessLinks"],
});
