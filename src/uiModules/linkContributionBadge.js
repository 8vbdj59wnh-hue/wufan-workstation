import { escapeHtml } from "../utils/html.js";

export function renderLinkContributionName(item) {
  const grade = ["S", "A", "B", "C", "D", "N"].includes(item.contributionGrade) ? item.contributionGrade : null;
  const description = grade ? `链接贡献级别：${grade}${grade === "N" ? "（新品）" : ""}` : item.contributionError || "尚未生成贡献评级";
  return `<span class="link-name-line"><span class="link-contribution-badge is-${grade || "pending"}" title="${escapeHtml(description)}" aria-label="${escapeHtml(description)}">${grade || "—"}</span><strong class="link-name-text">${escapeHtml(item.name)}</strong></span>`;
}
