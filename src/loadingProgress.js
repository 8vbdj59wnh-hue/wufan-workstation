const LOADING_TEXT_PATTERN = /(?:正在(?:加载|读取|汇总|获取|更新|生成|查询|同步|连接|发现|计算|分析)|加载中|请稍候)/;
const LOADING_CANDIDATE_SELECTOR = [
  ".startup-loading",
  ".startup-page-loading",
  ".route-module-loading",
  ".empty-state",
  ".empty-detail",
  ".form-note",
  ".product-detail-empty",
].join(",");

const progressStates = new WeakMap();

export function getEstimatedLoadingDuration(label = "") {
  if (/同步|导入|生成|分析/.test(label)) return 30000;
  if (/汇总|经营|计算/.test(label)) return 15000;
  return 8000;
}

export function getEstimatedLoadingProgress(elapsedMs, durationMs) {
  const safeDuration = Math.max(1000, Number(durationMs) || 8000);
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  // 估算进度不能代表请求已经完成；真实完成由加载节点被业务内容替换来表达。
  // 保留在 95%，避免请求仍在进行时误显示“100% / 加载完成”。
  return Math.min(95, Math.max(8, Math.round(8 + (elapsed / safeDuration) * 87)));
}

function getLoadingCopy(element) {
  const title = element.querySelector(".startup-loading-title, h1, h2, h3, strong")?.textContent?.trim();
  const note = element.querySelector(".startup-loading-note, p:not(.startup-loading-title)")?.textContent?.trim();
  const fullText = element.textContent?.replace(/\s+/g, " ").trim() || "正在加载…";
  return {
    label: title || fullText,
    note: note && note !== title ? note : "",
  };
}

function createElement(className, text = "") {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = text;
  return element;
}

function enhanceLoadingElement(element) {
  if (!(element instanceof HTMLElement) || element.dataset.loadingProgressEnhanced === "true") return;
  if (["BUTTON", "INPUT", "SELECT", "TEXTAREA", "OPTION"].includes(element.tagName)) return;

  const copy = getLoadingCopy(element);
  if (!LOADING_TEXT_PATTERN.test(`${copy.label} ${copy.note}`)) return;

  const brand = element.querySelector(".brand-mark")?.cloneNode(true);
  const initialProgress = Number(element.dataset.loadingProgressValue || 8);
  const durationMs = Number(element.dataset.loadingEstimatedMs) || getEstimatedLoadingDuration(copy.label);
  const label = createElement("app-loading-progress-label", copy.label);
  const note = copy.note ? createElement("app-loading-progress-note", copy.note) : null;
  const track = createElement("app-loading-progress-track");
  const fill = createElement("app-loading-progress-fill");
  const meta = createElement("app-loading-progress-meta");
  const percent = createElement("app-loading-progress-percent", `预计 ${initialProgress}%`);
  const remaining = createElement("app-loading-progress-remaining", `预计还需约 ${Math.ceil(durationMs / 1000)} 秒`);

  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-label", copy.label);
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  track.setAttribute("aria-valuenow", String(initialProgress));
  fill.style.width = `${initialProgress}%`;
  track.append(fill);
  meta.append(percent, remaining);

  element.replaceChildren();
  if (brand) element.append(brand);
  element.append(label);
  if (note) element.append(note);
  element.append(track, meta);
  element.classList.add("app-loading-progress");
  if (element.classList.contains("compact")) element.classList.add("is-compact");
  element.dataset.loadingProgressEnhanced = "true";
  element.setAttribute("aria-live", "polite");
  element.setAttribute("aria-busy", "true");

  progressStates.set(element, {
    startedAt: performance.now(),
    durationMs,
    fixedProgress: element.dataset.loadingProgressValue === undefined ? null : initialProgress,
    track,
    fill,
    percent,
    remaining,
  });
}

function scanLoadingElements(root = document) {
  if (root instanceof Element && root.matches(LOADING_CANDIDATE_SELECTOR)) enhanceLoadingElement(root);
  root.querySelectorAll?.(LOADING_CANDIDATE_SELECTOR).forEach(enhanceLoadingElement);
}

function updateLoadingProgress() {
  document.querySelectorAll("[data-loading-progress-enhanced='true']").forEach((element) => {
    const state = progressStates.get(element);
    if (!state) return;
    const elapsedMs = performance.now() - state.startedAt;
    const progress = state.fixedProgress ?? getEstimatedLoadingProgress(elapsedMs, state.durationMs);
    const remainingSeconds = Math.max(0, Math.ceil((state.durationMs - elapsedMs) / 1000));
    state.fill.style.width = `${progress}%`;
    state.track.setAttribute("aria-valuenow", String(progress));
    state.percent.textContent = state.fixedProgress === null ? `预计 ${progress}%` : `${progress}%`;
    state.remaining.textContent = state.fixedProgress === null
      ? (remainingSeconds > 0 ? `预计还需约 ${remainingSeconds} 秒` : "仍在读取，请稍候")
      : "正在处理";
  });
}

export function installLoadingProgress() {
  if (typeof document === "undefined" || document.documentElement.dataset.loadingProgressInstalled === "true") return;
  document.documentElement.dataset.loadingProgressInstalled = "true";
  scanLoadingElements(document);
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
      if (node instanceof Element) scanLoadingElements(node);
    }));
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.setInterval(updateLoadingProgress, 500);
}
