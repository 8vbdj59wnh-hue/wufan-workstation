import { getCurrentUser } from "../appState.js";
import { hasPermission } from "../../shared/permissions.js";
import { renderScheduleBoardPage, bindScheduleBoardPageEvents } from "../scheduleBoardPage.js";
const tabs = [["requests", "下周需求"], ["schedule", "内容排期"], ["configuration", "账号与栏目"]];
export function renderContentCenterPage() {
  let destination = window.location.hash.split("/")[1] || "";
  try { destination = decodeURIComponent(destination); } catch { destination = ""; }
  if (destination === "schedule") return `<section class="content-center-native-schedule"><h2>内容排期</h2><nav class="content-center-native-tabs" aria-label="内容中心导航">${tabs.map(([id, label]) => `<a href="#contentCenter/${id}" ${id === "schedule" ? 'aria-current="page"' : ''}>${label}</a>`).join("")}</nav>${hasPermission(getCurrentUser(), "keyActions.view") ? renderScheduleBoardPage() : '<p role="status">查看内容排期需要关键行动查看权限。</p>'}</section>`;
  if (destination === "candidates") destination="requests";
  const query = tabs.some(([id]) => id === destination) ? "?page=" + destination : destination ? "?note=" + encodeURIComponent(destination) : "";
  return `<section class="content-center-page" aria-label="内容中心"><iframe title="内容中心：下周需求、策划候选与内容排期" src="/public/content-center/index.html${query}" style="width:100%;height:calc(100vh - 135px);min-height:620px;border:0;border-radius:16px;background:#fff"></iframe></section>`;
}
export function bindContentCenterPageEvents(rerender) {
  if (window.location.hash === "#contentCenter/schedule" && hasPermission(getCurrentUser(), "keyActions.view")) bindScheduleBoardPageEvents(rerender);
}
