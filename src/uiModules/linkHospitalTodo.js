import { registerUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js";

export function renderLinkHospitalTodo({ items = [], counts = {} } = {}) {
  return `<section class="link-hospital-todo-module" data-module-key="link_hospital_todo"><header><div><span>待处理问题</span><small>待诊断 ${Number(counts.diagnosis || 0)} · 治疗中 ${Number(counts.treatment || 0)} · 观察中 ${Number(counts.observation || 0)}</small></div><button type="button" class="text-button" data-workbench-go="hospital">进入链接医院 →</button></header>${items.length ? `<div>${items.slice(0, 6).map((item) => `<button type="button" data-workbench-hospital="${escapeHtml(item.stage)}"><span><strong>${escapeHtml(item.connectionName)}</strong><small>${escapeHtml(item.problemTitle || "经营异常")}</small></span><em>${escapeHtml(item.stageLabel)}</em><b>${item.healthScore == null ? "暂无健康分" : `${Number(item.healthScore)}分`}</b></button>`).join("")}</div>` : `<div class="empty-state compact">当前没有已确认的待处理事项</div>`}</section>`;
}

registerUiModule({
  moduleKey: "link_hospital_todo",
  name: "MyLinkHospitalTodo",
  domain: "business_links",
  description: "复用链接医院结果，展示当前运营需要处理的问题链接。",
  render: renderLinkHospitalTodo,
  configSchema: { limit: "number" },
  dependencies: ["BusinessLink", "ConnectionHospital"],
});
