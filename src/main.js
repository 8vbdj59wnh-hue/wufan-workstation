import { modules } from "./modules.js?v=20260627-methods1";
import { bindGoalsPageEvents, renderGoalsPage } from "./goalsPage.js?v=20260627-methods1";
import { bindProcessesPageEvents, renderProcessesPage } from "./processesPage.js?v=20260627-methods1";
import { bindSettingsPageEvents, renderSettingsPage } from "./settingsPage.js?v=20260627-methods1";
import { bindTasksPageEvents, renderTasksPage } from "./tasksPage.js?v=20260627-methods1";
import { bindTimePageEvents, renderTimePage } from "./timePage.js?v=20260627-methods1";
import { bindAssessmentPageEvents, renderAssessmentPage } from "./assessmentPage.js?v=20260627-methods1";
import { bindMethodologiesPageEvents, renderMethodologiesPage } from "./methodologiesPage.js?v=20260627-methods1";
import {
  flushPersistentSave,
  getCurrentUser,
  getPersistenceStatus,
  loadPersistentData,
  login,
  logout,
  schedulePersistentSave,
  validateCurrentSession,
} from "./appState.js?v=20260627-methods1";
import { canAccessModule, getFirstAccessibleModule } from "./permissions.js?v=20260627-methods1";

const app = document.querySelector("#app");

const moduleHashMap = {
  goals: "goals",
  tasks: "tasks",
  processes: "processes",
  time: "time",
  assessment: "assessment",
  methods: "methods",
  settings: "settings",
  "task-list": "tasks",
  clearance: "tasks",
  "process-progress": "tasks",
  "task-library": "tasks",
  "content-schedule": "tasks",
  "process-templates": "processes",
  "started-processes": "processes",
  "future-tasks": "time",
  quadrants: "time",
  "week-tasks": "time",
  "future-works": "time",
  "work-priority": "time",
  "week-works": "time",
  "assessment-stats": "assessment",
  "assessment-reports": "assessment",
  "assessment-problems": "assessment",
  methodologies: "methods",
  methods: "methods",
  organization: "settings",
  people: "settings",
  stores: "settings",
  categories: "settings",
};

function getRouteHash() {
  return window.location.hash.replace(/^#/, "");
}

function scrollToCurrentHashSection() {
  const hash = getRouteHash();
  if (hash === "") return;
  window.requestAnimationFrame(() => {
    document.getElementById(hash)?.scrollIntoView({ block: "start" });
  });
}

function getModuleIdFromHash() {
  const hash = getRouteHash();
  if (hash.startsWith("process-template-")) return "processes";
  if (hash.startsWith("methodology-")) return "methods";
  return moduleHashMap[hash] ?? modules[0].id;
}

let activeModuleId = getModuleIdFromHash();
let loginError = "";

function getActiveModule() {
  return modules.find((module) => module.id === activeModuleId) ?? modules[0];
}

function getAccessibleModules() {
  return modules.filter((module) => canAccessModule(getCurrentUser(), module.id));
}

function renderSidebar() {
  return `
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark"></span>
        <span class="brand-name">屋范·极简工作站</span>
      </div>
      <nav class="nav" aria-label="主导航">
        ${getAccessibleModules()
          .map(
            (module) => `
              <button
                class="nav-item ${module.id === activeModuleId ? "is-active" : ""}"
                type="button"
                data-module-id="${module.id}"
              >
                ${module.name}
              </button>
            `,
          )
          .join("")}
      </nav>
    </aside>
  `;
}

function renderPage() {
  const activeModule = getActiveModule();
  const persistenceStatus = getPersistenceStatus();
  const currentUser = getCurrentUser();
  const canAccessActiveModule = canAccessModule(currentUser, activeModule.id);
  let content = `
        <section class="placeholder" aria-label="${activeModule.name}占位页面">
          <h2>${activeModule.name}</h2>
          <p>该模块页面已创建，后续可在此逐步补充具体业务功能。</p>
        </section>
      `;

  if (!canAccessActiveModule) {
    content = `<section class="placeholder"><h2>你没有权限访问该页面</h2><p>请联系管理员调整账号权限。</p></section>`;
  } else if (activeModule.id === "goals") {
    content = renderGoalsPage();
  }

  if (activeModule.id === "tasks") {
    content = renderTasksPage();
  }

  if (activeModule.id === "processes") {
    content = renderProcessesPage();
  }

  if (activeModule.id === "time") {
    content = renderTimePage();
  }

  if (activeModule.id === "assessment") {
    content = renderAssessmentPage();
  }

  if (activeModule.id === "methods") {
    content = renderMethodologiesPage(currentUser);
  }

  if (activeModule.id === "settings") {
    content = renderSettingsPage();
  }

  return `
    <main class="page">
      <header class="page-header">
        <h1>${activeModule.name}</h1>
        <div class="user-menu">
          <span>${currentUser?.name || currentUser?.username || "已登录"}</span>
          <button class="text-button" type="button" data-action="logout">退出登录</button>
        </div>
      </header>
      ${
        persistenceStatus.message
          ? `<div class="db-status is-${persistenceStatus.kind}">${persistenceStatus.message}</div>`
          : ""
      }
      ${
        currentUser?.mustChangePassword
          ? `<div class="db-status is-error">请尽快修改默认管理员密码。</div>`
          : ""
      }
      ${content}
    </main>
  `;
}

function renderLoginPage() {
  app.innerHTML = `
    <main class="login-page">
      <form class="login-panel">
        <div>
          <span class="brand-mark"></span>
          <h1>系统登录</h1>
        </div>
        <label>
          <span>账号</span>
          <input name="username" autocomplete="username" />
        </label>
        <label>
          <span>密码</span>
          <input name="password" type="password" autocomplete="current-password" />
        </label>
        <div class="form-error" ${loginError === "" ? "hidden" : ""}>${loginError}</div>
        <button class="primary-button" type="submit">登录</button>
        <p class="login-motto">做对的事，把事做对</p>
      </form>
    </main>
  `;

  document.querySelector(".login-panel")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const result = await login(
      formData.get("username")?.toString().trim() ?? "",
      formData.get("password")?.toString() ?? "",
    );

    if (!result.success) {
      loginError = result.message ?? "账号或密码错误";
      renderLoginPage();
      return;
    }

    loginError = "";
    await loadPersistentData();
    const firstAccessibleModule = getFirstAccessibleModule(getCurrentUser(), modules);
    window.location.hash = firstAccessibleModule?.id ?? "goals";
    render();
  });
}

function updatePersistenceBanner() {
  const status = getPersistenceStatus();
  const existingBanner = document.querySelector(".db-status");

  if (status.message === "") {
    existingBanner?.remove();
    return;
  }

  if (existingBanner !== null) {
    existingBanner.className = `db-status is-${status.kind}`;
    existingBanner.textContent = status.message;
    return;
  }

  const pageHeader = document.querySelector(".page-header");
  if (pageHeader !== null) {
    pageHeader.insertAdjacentHTML("afterend", `<div class="db-status is-${status.kind}">${status.message}</div>`);
  }
}

function render() {
  activeModuleId = getModuleIdFromHash();
  const firstAccessibleModule = getFirstAccessibleModule(getCurrentUser(), modules);

  if (firstAccessibleModule === null) {
    const currentUser = getCurrentUser();
    app.innerHTML = `
      <div class="app-shell">
        <main class="page">
          <header class="page-header">
            <h1>系统</h1>
            <div class="user-menu">
              <span>${currentUser?.name || currentUser?.username || "已登录"}</span>
              <button class="text-button" type="button" data-action="logout">退出登录</button>
            </div>
          </header>
          <section class="placeholder"><h2>当前账号未配置可访问模块，请联系管理员。</h2></section>
        </main>
      </div>
    `;
    document.querySelector('[data-action="logout"]')?.addEventListener("click", () => {
      logout();
      loginError = "";
      renderLoginPage();
    });
    return;
  }

  app.innerHTML = `
    <div class="app-shell">
      ${renderSidebar()}
      ${renderPage()}
    </div>
  `;

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      const nextModuleId = item.dataset.moduleId;
      if (getRouteHash() === nextModuleId) {
        activeModuleId = nextModuleId;
        render();
        return;
      }
      window.location.hash = nextModuleId;
    });
  });

  document.querySelector('[data-action="logout"]')?.addEventListener("click", () => {
    logout();
    loginError = "";
    renderLoginPage();
  });

  if (activeModuleId === "settings") {
    bindSettingsPageEvents(render);
  }

  if (activeModuleId === "goals") {
    bindGoalsPageEvents(render);
  }

  if (activeModuleId === "tasks") {
    bindTasksPageEvents(render);
  }

  if (activeModuleId === "processes" || document.querySelector(".processes-page") !== null) {
    bindProcessesPageEvents(render);
  }

  if (activeModuleId === "time") {
    bindTimePageEvents(render);
  }

  if (activeModuleId === "assessment") {
    bindAssessmentPageEvents(render);
  }

  if (activeModuleId === "methods" || document.querySelector(".methodologies-page") !== null) {
    bindMethodologiesPageEvents(render);
  }

  scrollToCurrentHashSection();
  schedulePersistentSave();
}

window.addEventListener("hashchange", render);
window.addEventListener("pagehide", flushPersistentSave);
window.addEventListener("beforeunload", flushPersistentSave);
window.addEventListener("persistence-status-change", updatePersistenceBanner);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushPersistentSave();
});

const currentUser = await validateCurrentSession();
if (currentUser === null) {
  renderLoginPage();
} else {
  await loadPersistentData();
  render();
}
