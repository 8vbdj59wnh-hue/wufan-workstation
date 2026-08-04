import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDatabase, uploadsDir } from "./db.js";

const checkpointRoot = path.join(uploadsDir, "data-sync-checkpoints");
const checkpointPath = (batchId) => path.join(checkpointRoot, `${batchId}.json`);
const signature = (windows, pageSize) => crypto.createHash("sha256").update(JSON.stringify({ windows, pageSize })).digest("hex");

function writeCheckpoint(batchId, value) {
  fs.mkdirSync(checkpointRoot, { recursive: true });
  const target = checkpointPath(batchId);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value));
  fs.renameSync(temporary, target);
}

function readCheckpoint(batchId, expectedSignature) {
  const target = checkpointPath(batchId);
  if (!fs.existsSync(target)) return null;
  const value = JSON.parse(fs.readFileSync(target, "utf8"));
  if (value.signature !== expectedSignature) throw new Error("同步批次断点与当前请求范围不一致，禁止错误续跑。");
  return value;
}

export function clearDataSyncCheckpoint(batchId) {
  fs.rmSync(checkpointPath(batchId), { force: true });
}

export async function runWangdianPagedWindows({
  batchId,
  windows,
  pageSize,
  queryPage,
  extractItems,
  extractTotal = (payload) => payload?.data?.total_count,
  onScheduleEvent,
} = {}) {
  const database = getDatabase();
  const unifiedBatch = database.prepare("SELECT id FROM data_sync_batches WHERE id=?").get(batchId);
  const requestSignature = signature(windows, pageSize);
  const saved = readCheckpoint(batchId, requestSignature);
  const rows = Array.isArray(saved?.rows) ? saved.rows : [];
  let windowIndex = Number(saved?.windowIndex || 0);
  let pageNo = Number(saved?.pageNo || 0);
  let pageCount = Number(saved?.pageCount || 0);
  let receivedInWindow = Number(saved?.receivedInWindow || 0);
  let totalInWindow = saved?.totalInWindow ?? null;

  const log = (level, eventType, message, detail = {}) => {
    if (!unifiedBatch) return;
    database.prepare("INSERT INTO data_sync_logs (id,batchId,level,eventType,message,detailJson,createdAt) VALUES (?,?,?,?,?,?,?)").run(
      `data-sync-log-${crypto.randomUUID()}`, batchId, level, eventType, message, JSON.stringify(detail), new Date().toISOString(),
    );
  };
  const persist = () => {
    const progress = { windowIndex, windowCount: windows.length, pageNo, pageCount, completedCount: rows.length, receivedInWindow, totalInWindow };
    writeCheckpoint(batchId, { signature: requestSignature, ...progress, rows });
    if (unifiedBatch) database.prepare("UPDATE data_sync_batches SET progressJson=? WHERE id=?").run(JSON.stringify(progress), batchId);
  };

  for (; windowIndex < windows.length; windowIndex += 1) {
    const window = windows[windowIndex];
    for (; pageNo < 10000; pageNo += 1) {
      const eventContext = { windowIndex, windowNumber: windowIndex + 1, windowCount: windows.length, pageNo };
      const payload = await queryPage({
        params: window,
        pageNo,
        pageSize,
        onScheduleEvent: (event) => {
          if (["throttle_wait", "rate_limit_retry", "request_failed"].includes(event.type)) {
            log(event.type === "request_failed" ? "error" : "warn", event.type, event.type === "rate_limit_retry" ? "旺店通限流，等待后重试。" : event.type === "throttle_wait" ? "旺店通请求按配额等待。" : "旺店通请求失败。", { ...eventContext, ...event });
          }
          onScheduleEvent?.({ ...eventContext, ...event });
        },
      });
      pageCount += 1;
      const items = extractItems(payload);
      if (pageNo === 0 && Number.isFinite(Number(extractTotal(payload)))) totalInWindow = Number(extractTotal(payload));
      rows.push(...items);
      receivedInWindow += items.length;
      const complete = items.length < pageSize || (totalInWindow !== null && receivedInWindow >= totalInWindow);
      log("info", "page_completed", `同步窗口 ${windowIndex + 1}/${windows.length} 第 ${pageNo + 1} 页读取完成。`, { ...eventContext, itemCount: items.length, completedCount: rows.length });
      if (complete) {
        windowIndex += 1;
        pageNo = 0;
        receivedInWindow = 0;
        totalInWindow = null;
        persist();
        windowIndex -= 1;
        break;
      }
      pageNo += 1;
      persist();
      pageNo -= 1;
    }
    if (pageNo >= 10000) throw new Error("旺店通分页数量异常，已停止读取。");
  }
  if (unifiedBatch) database.prepare("UPDATE data_sync_batches SET progressJson=? WHERE id=?").run(JSON.stringify({ windowIndex: windows.length, windowCount: windows.length, pageNo: 0, pageCount, completedCount: rows.length, completed: true }), batchId);
  log("info", "paged_read_completed", "旺店通全部窗口读取完成。", { windowCount: windows.length, pageCount, completedCount: rows.length });
  return { rows, pageCount, resumed: Boolean(saved) };
}
