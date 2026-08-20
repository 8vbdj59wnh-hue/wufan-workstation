import { bindAssessmentPageEvents, renderAssessmentPage } from "./assessmentPage.js";
import { bindOperationDashboardPageEvents, renderOperationDashboardPage } from "./operationDashboardPage.js";
import { ensureDashboardManagementLoaded, getCurrentUser } from "./appState.js";
import { hasPermission } from "../shared/permissions.js";

function currentView() {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash === "dashboard-operation" || hash === "operationDashboard" || hash === "operation-dashboard") return "operation";
  if (hash === "dashboard-management" || hash === "assessment" || hash.startsWith("assessment-")) return "management";
  return "home";
}

function canViewOperation() {
  return hasPermission(getCurrentUser(), "operations.view");
}

function canViewManagement() {
  return hasPermission(getCurrentUser(), "assessment.view");
}

function renderHome() {
  return `<section class="dashboard-entry-grid">
    <article class="dashboard-entry-card is-operation"><div class="dashboard-entry-icon">营</div><div><p class="eyebrow">老板与经营负责人</p><h2>经营驾驶舱</h2><p>查看销售、利润、产品、链接、客户、供应链和风险提醒。</p><strong>回答：公司经营怎么样？</strong></div><button class="primary-button" type="button" data-dashboard-view="operation" ${canViewOperation() ? "" : "disabled"}>进入经营视角</button></article>
    <article class="dashboard-entry-card is-management"><div class="dashboard-entry-icon">管</div><div><p class="eyebrow">管理者与团队负责人</p><h2>管理驾驶舱</h2><p>查看目标、关键行动、任务、问题、改善项目与工作结果。</p><strong>回答：安排的事情有没有做好？</strong></div><button class="primary-button" type="button" data-dashboard-view="management" ${canViewManagement() ? "" : "disabled"}>进入管理视角</button></article>
  </section>`;
}

function renderViewContent(view) {
  if (view === "operation") return canViewOperation() ? renderOperationDashboardPage() : `<section class="placeholder"><h2>没有经营驾驶舱权限</h2><p>请联系管理员开通数据中心查看权限。</p></section>`;
  if (view === "management") return canViewManagement() ? renderAssessmentPage() : `<section class="placeholder"><h2>没有管理驾驶舱权限</h2><p>请联系管理员开通工作结果查看权限。</p></section>`;
  return renderHome();
}

export function renderDashboardPage() {
  const view = currentView();
  return `<section class="unified-dashboard-page"><header class="unified-dashboard-hero"><div><p class="eyebrow">企业统一管理入口</p><h1>驾驶舱</h1><p>经营看事实与风险，管理看执行与改善，从问题发现连接到行动结果。</p></div></header>
    <nav class="unified-dashboard-tabs" aria-label="驾驶舱视角"><button class="${view === "home" ? "is-active" : ""}" type="button" data-dashboard-view="home">总览</button><button class="${view === "operation" ? "is-active" : ""}" type="button" data-dashboard-view="operation" ${canViewOperation() ? "" : "disabled"}>经营视角</button><button class="${view === "management" ? "is-active" : ""}" type="button" data-dashboard-view="management" ${canViewManagement() ? "" : "disabled"}>管理视角</button></nav>
    <div class="unified-dashboard-content">${renderViewContent(view)}</div></section>`;
}

export function bindDashboardPageEvents(rerender) {
  if (currentView() === "management") void ensureDashboardManagementLoaded().then((changed) => { if (changed) rerender(); }).catch(() => {});
  const page = document.querySelector(".unified-dashboard-page");
  if (!page) return;
  page.querySelectorAll("[data-dashboard-view]").forEach((button) => button.addEventListener("click", () => {
    const view = button.dataset.dashboardView;
    window.location.hash = view === "operation" ? "dashboard-operation" : view === "management" ? "dashboard-management" : "dashboard";
  }));
  const view = currentView();
  if (view === "operation" && canViewOperation()) bindOperationDashboardPageEvents(rerender);
  if (view === "management" && canViewManagement()) bindAssessmentPageEvents(rerender);
}
