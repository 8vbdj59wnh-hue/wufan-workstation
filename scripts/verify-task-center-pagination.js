import { spawn } from "node:child_process";
import { createToken } from "../server/security.js";

const port = 3399;
const databasePath = process.env.WUFAN_DB_PATH;
if (!databasePath) throw new Error("请通过 WUFAN_DB_PATH 指定隔离数据库。");

const child = spawn(process.execPath, ["server/index.js"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, WUFAN_DB_PATH: databasePath, PORT: String(port), HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("隔离验证服务启动超时。");
}

try {
  await waitForServer();
  const token = createToken({ id: "person-001", username: "admin", authRole: "admin" });
  const headers = { Authorization: `Bearer ${token}` };
  const measure = async (url) => {
    const startedAt = performance.now();
    const response = await fetch(url, { headers });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status}: ${text}`);
    return { milliseconds: performance.now() - startedAt, bytes: Buffer.byteLength(text), data: JSON.parse(text) };
  };
  const bootstrap = await measure(`http://127.0.0.1:${port}/api/bootstrap?module=tasks`);
  const samples = [];
  for (let index = 0; index < 10; index += 1) {
    samples.push(await measure(`http://127.0.0.1:${port}/api/task-center/tasks?page=1&pageSize=50&view=all&filters=%7B%7D`));
  }
  const ordered = samples.map((item) => item.milliseconds).sort((left, right) => left - right);
  const latest = samples.at(-1);
  const directTasks = await measure(`http://127.0.0.1:${port}/api/task-center/tasks?page=1&pageSize=100&view=all&filters=${encodeURIComponent(JSON.stringify({ source: "direct", showDone: true, showCanceled: true }))}`);
  const improvementTasks = await measure(`http://127.0.0.1:${port}/api/task-center/tasks?page=1&pageSize=100&view=all&filters=${encodeURIComponent(JSON.stringify({ source: "process", showDone: true, showCanceled: true }))}`);
  if (directTasks.data.items.some((item) => item.source === "process")) throw new Error("普通任务类型筛选返回了改善行动任务。");
  if (improvementTasks.data.items.some((item) => item.source !== "process")) throw new Error("改善行动任务类型筛选返回了普通任务。");
  const doneTasks = await measure(`http://127.0.0.1:${port}/api/task-center/tasks?page=1&pageSize=100&view=all&filters=${encodeURIComponent(JSON.stringify({ status: "done" }))}`);
  const canceledTasks = await measure(`http://127.0.0.1:${port}/api/task-center/tasks?page=1&pageSize=100&view=all&filters=${encodeURIComponent(JSON.stringify({ status: "canceled" }))}`);
  if (doneTasks.data.items.some((item) => item.status !== "done")) throw new Error("已完成状态筛选返回了其他状态。");
  if (canceledTasks.data.items.some((item) => item.status !== "canceled")) throw new Error("已取消状态筛选返回了其他状态。");
  if (doneTasks.data.total === 0) throw new Error("已完成状态筛选没有返回实际存在的已完成任务。");
  const searchableAction = improvementTasks.data.context?.processInstances?.find((item) => item.businessCode);
  if (searchableAction) {
    const actionSearch = await measure(`http://127.0.0.1:${port}/api/task-center/tasks?page=1&pageSize=100&view=today&keyword=${encodeURIComponent(searchableAction.businessCode)}&filters=%7B%7D`);
    if (actionSearch.data.total === 0) throw new Error("使用行动编码搜索没有返回任务。");
    if (actionSearch.data.items.some((item) => item.processInstanceId !== searchableAction.id)) throw new Error("行动编码搜索返回了其他行动的任务。");
  }
  const totalBytes = bootstrap.bytes + latest.bytes;
  const result = {
    bootstrapBytes: bootstrap.bytes,
    listBytes: latest.bytes,
    firstLoadBytes: totalBytes,
    firstLoadMegabytes: Number((totalBytes / 1_000_000).toFixed(3)),
    totalTasks: latest.data.total,
    returnedTasks: latest.data.items.length,
    directTaskCount: directTasks.data.total,
    improvementTaskCount: improvementTasks.data.total,
    doneTaskCount: doneTasks.data.total,
    canceledTaskCount: canceledTasks.data.total,
    p50Milliseconds: Number(ordered[Math.floor(ordered.length * 0.5)].toFixed(1)),
    p95Milliseconds: Number(ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)].toFixed(1)),
  };
  if (totalBytes >= 1_000_000) throw new Error(`首屏任务数据仍超过1MB：${totalBytes}`);
  if (result.p95Milliseconds >= 1000) throw new Error(`任务列表P95仍超过1秒：${result.p95Milliseconds}ms`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  child.kill("SIGTERM");
}
