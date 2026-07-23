import { modules } from "./modules.js?v=20260705-state-singleton1";
import { bindGoalsPageEvents, renderGoalsPage } from "./goalsPage.js?v=20260705-state-singleton1";
import { bindProcessesPageEvents, renderProcessesPage } from "./processesPage.js?v=20260722-processes-page1";
import { bindSettingsPageEvents, renderSettingsPage } from "./settingsPage.js?v=20260705-state-singleton1";
import { bindTasksPageEvents, renderTasksPage, selectTask } from "./tasksPage.js?v=20260724-action-template-link1";
import { bindScheduleBoardPageEvents, renderScheduleBoardPage } from "./scheduleBoardPage.js?v=20260722-due-date-boundary2";
import { bindAssessmentPageEvents, renderAssessmentPage } from "./assessmentPage.js?v=20260717-work-results-dashboard1";
import { bindMethodologiesPageEvents } from "./methodologiesPage.js?v=20260705-state-singleton1";
import { bindTemplateCenterPageEvents, renderTemplateCenterPage } from "./templateCenterPage.js?v=20260705-state-singleton1";
import { attachThumbnailHoverPreview } from "./thumbnailPreview.js?v=20260723-task-card-static1";
import {
  flushPersistentSave,
  getCurrentUser,
  getCurrentUserNotifications,
  getUnreadNotificationCount,
  getPersistenceStatus,
  loadPersistentData,
  login,
  logout,
  markAllNotificationsRead,
  markNotificationRead,
  resolveAssetUrl,
  state,
  syncTaskNotificationsForCurrentUser,
  updateCurrentUserAvatar,
  uploadImageFile,
  validateCurrentSession,
} from "./appState.js?v=20260705-state-singleton1";
import { canAccessModule, getFirstAccessibleModule } from "./permissions.js?v=20260705-state-singleton1";

const app = document.querySelector("#app");

const moduleHashMap = {
  goals: "goals",
  tasks: "tasks",
  scheduleBoard: "scheduleBoard",
  "schedule-board": "scheduleBoard",
  "task-schedule-board": "scheduleBoard",
  processes: "processes",
  assessment: "assessment",
  templateCenter: "templateCenter",
  "template-center": "templateCenter",
  methods: "processes",
  settings: "settings",
  "task-list": "tasks",
  clearance: "tasks",
  "process-progress": "tasks",
  "task-library": "processes",
  "content-schedule": "tasks",
  contentSchedule: "tasks",
  contentSchedules: "tasks",
  "process-templates": "processes",
  "started-processes": "processes",
  "assessment-stats": "assessment",
  "assessment-reports": "assessment",
  "assessment-problems": "assessment",
  "assessment-rectifications": "assessment",
  "assessment-person-profiles": "assessment",
  methodologies: "processes",
  methods: "processes",
  organization: "settings",
  "settings/organization": "settings",
  people: "settings",
  "settings/people": "settings",
  permissions: "settings",
  "settings/permissions": "settings",
  stores: "settings",
  "settings/stores": "settings",
  categories: "settings",
  "settings/categories": "settings",
  "publishing-accounts": "settings",
  "settings/publishing-accounts": "settings",
  "form-design": "settings",
  "settings/form-design": "settings",
  "template-tags": "settings",
  "settings/template-tags": "settings",
  "issues-requirements": "settings",
  "settings/issues-requirements": "settings",
};

function getRouteHash() {
  return window.location.hash.replace(/^#/, "");
}

function scrollToCurrentHashSection() {
  const hash = getRouteHash();
  if (hash === "") return;
  if (moduleHashMap[hash] === "settings" && hash !== "settings") return;
  const sectionId = hash.includes("/") ? hash.split("/").at(-1) : hash;
  window.requestAnimationFrame(() => {
    document.getElementById(sectionId)?.scrollIntoView({ block: "start" });
  });
}

function getModuleIdFromHash() {
  const hash = getRouteHash();
  if (hash.startsWith("process-template-")) return "processes";
  if (hash.startsWith("methodology-")) return "processes";
  return moduleHashMap[hash] ?? modules[0].id;
}

let activeModuleId = getModuleIdFromHash();
let lastRenderedRouteHash = null;
let loginError = "";
let notificationPanelOpen = false;

function getActiveModule() {
  return modules.find((module) => module.id === activeModuleId) ?? modules[0];
}

function getAccessibleModules() {
  return modules.filter((module) => canAccessModule(getCurrentUser(), module.id));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderNotificationPanel() {
  if (!notificationPanelOpen) return "";
  const notifications = getCurrentUserNotifications();
  return `
    <div class="notification-panel">
      <div class="notification-panel-header">
        <strong>任务提醒</strong>
        <button class="text-button" type="button" data-action="mark-all-notifications-read">全部已读</button>
      </div>
      ${
        notifications.length === 0
          ? `<p class="form-note">暂无任务提醒</p>`
          : notifications
              .slice(0, 12)
              .map(
                (notification) => `
                  <button class="notification-item ${notification.status === "unread" ? "is-unread" : ""}" type="button" data-action="open-notification-task" data-notification-id="${escapeHtml(notification.id)}" data-task-id="${escapeHtml(notification.taskId ?? "")}">
                    <span class="notification-title">${escapeHtml(notification.title)}</span>
                    <span class="notification-message">${escapeHtml(notification.message ?? "")}</span>
                  </button>
                `,
              )
              .join("")
      }
    </div>
  `;
}

function renderNotificationButton() {
  const unreadCount = getUnreadNotificationCount();
  return `
    <div class="notification-menu">
      <button class="icon-button notification-button" type="button" data-action="toggle-notifications" aria-label="任务提醒" title="任务提醒">
        <svg class="notification-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 10v4h3l6 4V6l-6 4H4Z" />
          <path d="M16 9.2a4 4 0 0 1 0 5.6" />
          <path d="M18.7 6.5a8 8 0 0 1 0 11" />
        </svg>
        ${unreadCount > 0 ? `<span class="notification-badge">${unreadCount}</span>` : ""}
      </button>
      ${renderNotificationPanel()}
    </div>
  `;
}

function getCurrentUserProfile(user) {
  const person = state.people.find((item) => item.id === user?.id);
  return {
    ...person,
    ...user,
    avatarUrl: user?.avatarUrl || person?.avatarUrl || "",
  };
}

function getAvatarInitial(user) {
  const displayName = user?.name || user?.username || "我";
  return escapeHtml(displayName.trim().slice(0, 1) || "我");
}

function renderUserProfile(user) {
  const profile = getCurrentUserProfile(user);
  const displayName = profile.name || profile.username || "已登录";
  const avatarUrl = profile.avatarUrl ? resolveAssetUrl(profile.avatarUrl) : "";
  return `
    <div class="user-profile">
      <label class="user-avatar-control" title="点击更换头像">
        ${
          avatarUrl
            ? `<img class="user-avatar-image" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}头像" />`
            : `<span class="user-avatar-placeholder">${getAvatarInitial(profile)}</span>`
        }
        <input class="visually-hidden" type="file" accept="image/*" data-user-avatar-input />
      </label>
      <span class="user-display-name">${escapeHtml(displayName)}</span>
    </div>
  `;
}

async function handleUserAvatarUpload(file) {
  if (file === undefined) return;
  try {
    const uploaded = await uploadImageFile(file);
    const updatedUser = await updateCurrentUserAvatar(uploaded.url);
    const person = state.people.find((item) => item.id === updatedUser?.id);
    if (person !== undefined) {
      person.avatarUrl = updatedUser.avatarUrl ?? uploaded.url;
      person.updatedAt = new Date().toISOString();
    }
    render();
  } catch (error) {
    console.error("头像保存失败", error);
    window.alert(error.message || "头像保存失败，请检查本地数据库服务。");
  }
}

function bindUserAvatarUpload() {
  document.querySelector("[data-user-avatar-input]")?.addEventListener("change", async (event) => {
    const input = event.currentTarget;
    await handleUserAvatarUpload(input.files?.[0]);
    input.value = "";
  });
}

function renderSidebar() {
  return `
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-name"><span>屋范</span><span>极简工作站</span></span>
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

  if (activeModule.id === "scheduleBoard") {
    content = renderScheduleBoardPage();
  }

  if (activeModule.id === "processes") {
    content = renderProcessesPage();
  }

  if (activeModule.id === "assessment") {
    content = renderAssessmentPage();
  }

  if (activeModule.id === "templateCenter") {
    content = renderTemplateCenterPage();
  }

  if (activeModule.id === "settings") {
    content = renderSettingsPage();
  }

  return `
    <main class="page">
      <header class="page-header">
        <h1>${activeModule.name}</h1>
        <div class="user-menu">
          ${renderNotificationButton()}
          ${renderUserProfile(currentUser)}
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
    await syncTaskNotificationsForCurrentUser();
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

function restorePageScroll(scrollTop) {
  window.requestAnimationFrame(() => {
    const page = document.querySelector(".page");
    if (page === null) return;
    const maximumScrollTop = Math.max(0, page.scrollHeight - page.clientHeight);
    page.scrollTop = Math.min(scrollTop, maximumScrollTop);
  });
}

function render({ navigation = false } = {}) {
  const previousPage = document.querySelector(".page");
  const previousScrollTop = previousPage?.scrollTop ?? 0;
  const previousModuleId = activeModuleId;
  const routeHash = getRouteHash();
  const isInitialRender = lastRenderedRouteHash === null;
  const routeChanged = !isInitialRender && lastRenderedRouteHash !== routeHash;
  const nextModuleId = getModuleIdFromHash();
  const shouldFollowHash = navigation || isInitialRender || routeChanged;
  const shouldRestoreScroll = previousPage !== null && !shouldFollowHash && previousModuleId === nextModuleId;

  activeModuleId = nextModuleId;
  lastRenderedRouteHash = routeHash;
  const firstAccessibleModule = getFirstAccessibleModule(getCurrentUser(), modules);

  if (firstAccessibleModule === null) {
    const currentUser = getCurrentUser();
    app.innerHTML = `
      <div class="app-shell">
        <main class="page">
          <header class="page-header">
            <h1>系统</h1>
            <div class="user-menu">
              ${renderUserProfile(currentUser)}
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
    bindUserAvatarUpload();
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

  bindUserAvatarUpload();

  document.querySelector('[data-action="toggle-notifications"]')?.addEventListener("click", () => {
    notificationPanelOpen = !notificationPanelOpen;
    render();
  });

  document.querySelector('[data-action="mark-all-notifications-read"]')?.addEventListener("click", async () => {
    await markAllNotificationsRead();
    render();
  });

  document.querySelectorAll('[data-action="open-notification-task"]').forEach((item) => {
    item.addEventListener("click", async () => {
      const notificationId = item.dataset.notificationId;
      const taskId = item.dataset.taskId;
      if (notificationId) await markNotificationRead(notificationId);
      if (taskId) selectTask(taskId);
      notificationPanelOpen = false;
      window.location.hash = "task-list";
      render();
    });
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

  if (activeModuleId === "scheduleBoard") {
    bindScheduleBoardPageEvents(render);
  }

  if (activeModuleId === "processes" || document.querySelector(".processes-page") !== null) {
    bindProcessesPageEvents(render);
  }

  if (activeModuleId === "assessment") {
    bindAssessmentPageEvents(render);
  }

  if (activeModuleId === "templateCenter") {
    bindTemplateCenterPageEvents(render);
  }

  if (document.querySelector(".methodologies-page") !== null) {
    bindMethodologiesPageEvents(render);
  }

  attachThumbnailHoverPreview();
  if (shouldFollowHash) {
    scrollToCurrentHashSection();
  } else if (shouldRestoreScroll) {
    restorePageScroll(previousScrollTop);
  }
}

function renderStartupError(error) {
  console.error("系统启动失败", error);
  const message = error?.message ?? "页面初始化没有完成，请刷新页面；如果反复出现，请联系管理员。";
  app.innerHTML = `
    <main class="login-page">
      <section class="login-panel">
        <div>
          <span class="brand-mark"></span>
          <h1>系统加载失败</h1>
        </div>
        <p class="form-error">${escapeHtml(message)}</p>
        <p class="form-note">为避免误用模拟数据，系统没有进入业务页面。请先确认后端服务和 SQLite 数据库正常。</p>
        <button class="primary-button" type="button" onclick="window.location.reload()">重新加载</button>
      </section>
    </main>
  `;
}

window.addEventListener("error", (event) => {
  if (app.innerHTML.trim() === "") renderStartupError(event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  if (app.innerHTML.trim() === "") renderStartupError(event.reason);
});
window.addEventListener("hashchange", () => render({ navigation: true }));
window.addEventListener("pagehide", flushPersistentSave);
window.addEventListener("beforeunload", flushPersistentSave);
window.addEventListener("persistence-status-change", updatePersistenceBanner);
document.addEventListener(
  "click",
  (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('[data-action="submit-modal-form"]');
    if (button === null) return;
    const form = button.closest(".modal-panel")?.querySelector("form");
    if (form === undefined || form === null) return;
    event.preventDefault();
    event.stopPropagation();
    const submitIntent = button.dataset.submitIntent ?? "";
    const submitter =
      submitIntent === ""
        ? null
        : Array.from(form.querySelectorAll('[type="submit"][data-submit-intent]')).find(
            (item) => item.dataset.submitIntent === submitIntent,
          ) ?? null;
    if (submitter instanceof HTMLElement) {
      form.requestSubmit(submitter);
      return;
    }
    form.requestSubmit();
  },
  true,
);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushPersistentSave();
});

try {
  const currentUser = await validateCurrentSession();
  if (currentUser === null) {
    renderLoginPage();
  } else {
    await loadPersistentData();
    await syncTaskNotificationsForCurrentUser();
    render();
  }
} catch (error) {
  renderStartupError(error);
}
