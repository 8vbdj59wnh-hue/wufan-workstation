import { bindAssessmentPageEvents, renderAssessmentPage } from "./assessmentPage.js";
import { bindOperationDashboardPageEvents, renderOperationDashboardPage } from "./operationDashboardPage.js";
import { ensureDashboardManagementLoaded, getCurrentUser } from "./appState.js";
import { hasPermission } from "../shared/permissions.js";

function currentView() {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash === "dashboard-operation" || hash === "operationDashboard" || hash === "operation-dashboard") return "operation";
  if (hash === "dashboard-management" || hash === "assessment" || hash.startsWith("assessment-")) return "management";
  return "operation";
}

function canViewOperation() {
  return hasPermission(getCurrentUser(), "operations.view");
}

function canViewManagement() {
  return hasPermission(getCurrentUser(), "assessment.view");
}

function renderViewContent(view) {
  if (view === "management") return canViewManagement() ? renderAssessmentPage() : `<section class="placeholder"><h2>没有管理驾驶舱权限</h2><p>请联系管理员开通工作结果查看权限。</p></section>`;
  return canViewOperation() ? renderOperationDashboardPage() : `<section class="placeholder"><h2>没有经营驾驶舱权限</h2><p>请联系管理员开通数据中心查看权限。</p></section>`;
}

export function renderDashboardViewTabs() {
  const view = currentView();
  return `<nav class="unified-dashboard-tabs" aria-label="驾驶舱视角"><button class="${view === "operation" ? "is-active" : ""}" type="button" data-dashboard-view="operation" ${canViewOperation() ? "" : "disabled"}>经营视角</button><button class="${view === "management" ? "is-active" : ""}" type="button" data-dashboard-view="management" ${canViewManagement() ? "" : "disabled"}>管理视角</button></nav>`;
}

export function renderDashboardPage() {
  const view = currentView();
  return `<section class="unified-dashboard-page"><div class="unified-dashboard-content">${renderViewContent(view)}</div></section>`;
}

export function bindDashboardPageEvents(rerender) {
  if (currentView() === "management") void ensureDashboardManagementLoaded().then((changed) => { if (changed) rerender(); }).catch(() => {});
  const page = document.querySelector(".unified-dashboard-page");
  if (!page) return;
  document.querySelectorAll("[data-dashboard-view]").forEach((button) => button.addEventListener("click", () => {
    const view = button.dataset.dashboardView;
    window.location.hash = view === "management" ? "dashboard-management" : "dashboard-operation";
  }));
  const view = currentView();
  if (view === "operation" && canViewOperation()) bindOperationDashboardPageEvents(rerender);
  if (view === "management" && canViewManagement()) bindAssessmentPageEvents(rerender);
}
