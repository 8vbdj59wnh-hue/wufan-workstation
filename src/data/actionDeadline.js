const terminalStatusLabels = new Map([
  ["done", "已完成"],
  ["completed", "已完成"],
  ["canceled", "已取消"],
  ["cancelled", "已取消"],
  ["stopped", "已终止"],
  ["terminated", "已终止"],
]);

function getDueTimestamp(value) {
  const text = String(value ?? "").trim();
  if (text === "") return null;
  const date = new Date(text.length === 10 ? `${text}T23:59:59+08:00` : text);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatDuration(milliseconds) {
  const totalMinutes = Math.max(1, Math.ceil(Math.abs(milliseconds) / 60000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}天${hours}小时`;
  return `${hours}小时${minutes}分钟`;
}

export function getActionDeadlinePresentation(action, now = Date.now()) {
  const terminalLabel = terminalStatusLabels.get(String(action?.status ?? "").toLowerCase());
  if (terminalLabel !== undefined) return { label: terminalLabel, overdue: false };

  const dueTimestamp = getDueTimestamp(action?.dueDate);
  if (dueTimestamp === null) return { label: "未设置截止时间", overdue: false };

  const nowTimestamp = now instanceof Date ? now.getTime() : Number(now);
  const safeNow = Number.isFinite(nowTimestamp) ? nowTimestamp : Date.now();
  const overdue = safeNow > dueTimestamp;
  return {
    label: `${overdue ? "已超时" : "剩余"} ${formatDuration(dueTimestamp - safeNow)}`,
    overdue,
  };
}
