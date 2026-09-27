import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";

const DEFAULT_INTERVAL_MS = 15_000;
const RAW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const API_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function readFileSize(filePath) {
  try { return fs.statSync(filePath).size; } catch { return 0; }
}

export function parseMacVmStatMemory(output, totalBytes = os.totalmem()) {
  const pageSize = Number(String(output).match(/page size of\s+(\d+)\s+bytes/i)?.[1] || 0);
  if (!pageSize || !Number.isFinite(totalBytes) || totalBytes <= 0) return null;
  const pages = Object.fromEntries([...String(output).matchAll(/^([^:\n]+):\s+(\d+)\.?$/gm)]
    .map((match) => [match[1].trim(), Number(match[2])]));
  const availablePages = Number(pages["Pages free"] || 0)
    + Number(pages["Pages inactive"] || 0)
    + Number(pages["Pages speculative"] || 0);
  if (!Number.isFinite(availablePages) || availablePages <= 0) return null;
  const availableBytes = Math.min(totalBytes, availablePages * pageSize);
  const usedBytes = Math.max(0, totalBytes - availableBytes);
  return {
    totalBytes,
    freeBytes: availableBytes,
    usedBytes,
    usedPercent: totalBytes ? usedBytes / totalBytes * 100 : 0,
    source: "macos-vm-stat",
  };
}

export function memorySnapshot({
  platform = os.platform(),
  totalBytes = os.totalmem(),
  freeBytes = os.freemem(),
  readMacVmStat = () => execFileSync("/usr/bin/vm_stat", [], {
    encoding: "utf8",
    timeout: 2_000,
    stdio: ["ignore", "pipe", "ignore"],
  }),
} = {}) {
  if (platform === "darwin") {
    try {
      const macSnapshot = parseMacVmStatMemory(readMacVmStat(), totalBytes);
      if (macSnapshot) return macSnapshot;
    } catch {
      // Fall back to Node's portable counters if vm_stat is unavailable.
    }
  }
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  return {
    totalBytes,
    freeBytes,
    usedBytes,
    usedPercent: totalBytes ? usedBytes / totalBytes * 100 : 0,
    source: "node-os",
  };
}

function diskSnapshot(targetPath) {
  try {
    const stats = fs.statfsSync(targetPath);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    return { totalBytes, freeBytes, usedBytes: Math.max(0, totalBytes - freeBytes), usedPercent: totalBytes ? ((totalBytes - freeBytes) / totalBytes) * 100 : 0 };
  } catch {
    return { totalBytes: 0, freeBytes: 0, usedBytes: 0, usedPercent: 0 };
  }
}

function cpuTimes() {
  return os.cpus().reduce((summary, cpu) => {
    const values = Object.values(cpu.times).map(Number);
    const total = values.reduce((sum, value) => sum + value, 0);
    return { total: summary.total + total, idle: summary.idle + Number(cpu.times.idle || 0) };
  }, { total: 0, idle: 0 });
}

function routeKey(request) {
  return String(request.route?.path ?? request.path ?? request.originalUrl ?? "unknown").split("?")[0].slice(0, 180);
}

function safeBusinessStatus(getBusinessDatabase) {
  try {
    const database = getBusinessDatabase();
    const latest = database.prepare(`SELECT status,COALESCE(completedAt,startedAt,createdAt) syncedAt
      FROM data_sync_batches ORDER BY COALESCE(completedAt,startedAt,createdAt) DESC,id DESC LIMIT 1`).get() ?? null;
    const openExceptions = Number(database.prepare("SELECT COUNT(*) value FROM data_sync_exceptions WHERE status='open'").get()?.value || 0);
    return { latestSync: latest, openExceptions, available: true };
  } catch {
    return { latestSync: null, openExceptions: null, available: false };
  }
}

export function createSystemMonitor({
  monitoringPath,
  databasePath,
  getBusinessDatabase,
  applicationVersion = "unknown",
  databaseHealth = null,
  intervalMs = DEFAULT_INTERVAL_MS,
  now = () => new Date(),
  autoStart = true,
} = {}) {
  if (!path.isAbsolute(monitoringPath || "")) throw new Error("monitoringPath must be an absolute path");
  const monitoringDatabase = new Database(monitoringPath);
  monitoringDatabase.pragma("journal_mode = WAL");
  monitoringDatabase.pragma("busy_timeout = 3000");
  monitoringDatabase.exec(`
    CREATE TABLE IF NOT EXISTS system_monitor_samples (
      capturedAt TEXT PRIMARY KEY,
      cpuPercent REAL NOT NULL,
      memoryUsedBytes INTEGER NOT NULL,
      memoryTotalBytes INTEGER NOT NULL,
      diskUsedBytes INTEGER NOT NULL,
      diskTotalBytes INTEGER NOT NULL,
      load1 REAL NOT NULL,
      processRssBytes INTEGER NOT NULL,
      processHeapUsedBytes INTEGER NOT NULL,
      processUptimeSeconds REAL NOT NULL,
      databaseBytes INTEGER NOT NULL,
      databaseWalBytes INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS system_monitor_api_buckets (
      bucketAt TEXT NOT NULL,
      route TEXT NOT NULL,
      method TEXT NOT NULL,
      requestCount INTEGER NOT NULL,
      errorCount INTEGER NOT NULL,
      totalDurationMs REAL NOT NULL,
      maxDurationMs REAL NOT NULL,
      durationsJson TEXT NOT NULL,
      PRIMARY KEY (bucketAt, route, method)
    );
    CREATE INDEX IF NOT EXISTS idx_system_monitor_samples_time ON system_monitor_samples(capturedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_system_monitor_api_time ON system_monitor_api_buckets(bucketAt DESC);
  `);

  const insertSample = monitoringDatabase.prepare(`INSERT OR REPLACE INTO system_monitor_samples
    (capturedAt,cpuPercent,memoryUsedBytes,memoryTotalBytes,diskUsedBytes,diskTotalBytes,load1,processRssBytes,processHeapUsedBytes,processUptimeSeconds,databaseBytes,databaseWalBytes)
    VALUES (@capturedAt,@cpuPercent,@memoryUsedBytes,@memoryTotalBytes,@diskUsedBytes,@diskTotalBytes,@load1,@processRssBytes,@processHeapUsedBytes,@processUptimeSeconds,@databaseBytes,@databaseWalBytes)`);
  const upsertApi = monitoringDatabase.prepare(`INSERT INTO system_monitor_api_buckets
    (bucketAt,route,method,requestCount,errorCount,totalDurationMs,maxDurationMs,durationsJson)
    VALUES (@bucketAt,@route,@method,@requestCount,@errorCount,@totalDurationMs,@maxDurationMs,@durationsJson)
    ON CONFLICT(bucketAt,route,method) DO UPDATE SET
      requestCount=requestCount+excluded.requestCount,
      errorCount=errorCount+excluded.errorCount,
      totalDurationMs=totalDurationMs+excluded.totalDurationMs,
      maxDurationMs=MAX(maxDurationMs,excluded.maxDurationMs),
      durationsJson=excluded.durationsJson`);

  let previousCpu = cpuTimes();
  let pendingApi = new Map();
  let timer = null;
  let lastCleanupAt = 0;

  function recordApiRequest(request, response, durationMs) {
    const route = routeKey(request);
    if (route.startsWith("/system-monitor") || route.startsWith("/api/system-monitor")) return;
    const method = String(request.method || "GET").toUpperCase();
    const key = `${method}\u0000${route}`;
    const item = pendingApi.get(key) ?? { route, method, requestCount: 0, errorCount: 0, totalDurationMs: 0, maxDurationMs: 0, durations: [] };
    item.requestCount += 1;
    item.errorCount += response.statusCode >= 500 ? 1 : 0;
    item.totalDurationMs += durationMs;
    item.maxDurationMs = Math.max(item.maxDurationMs, durationMs);
    if (item.durations.length < 240) item.durations.push(durationMs);
    pendingApi.set(key, item);
  }

  function flushApi(capturedAt) {
    const batch = pendingApi;
    pendingApi = new Map();
    // One row per collection interval keeps percentile samples intact while
    // still avoiding a monitoring-database write for every HTTP request.
    const bucketAt = capturedAt;
    const transaction = monitoringDatabase.transaction(() => {
      for (const item of batch.values()) upsertApi.run({ ...item, bucketAt, durationsJson: JSON.stringify(item.durations.slice(-240)) });
    });
    transaction();
  }

  function collect() {
    const capturedAt = now().toISOString();
    const currentCpu = cpuTimes();
    const totalDelta = Math.max(1, currentCpu.total - previousCpu.total);
    const idleDelta = Math.max(0, currentCpu.idle - previousCpu.idle);
    previousCpu = currentCpu;
    const hostMemory = memorySnapshot();
    const memoryTotalBytes = hostMemory.totalBytes;
    const memoryUsedBytes = hostMemory.usedBytes;
    const disk = diskSnapshot(path.dirname(databasePath));
    const memory = process.memoryUsage();
    insertSample.run({
      capturedAt,
      cpuPercent: clamp((1 - idleDelta / totalDelta) * 100, 0, 100),
      memoryUsedBytes,
      memoryTotalBytes,
      diskUsedBytes: disk.usedBytes,
      diskTotalBytes: disk.totalBytes,
      load1: Number(os.loadavg()[0] || 0),
      processRssBytes: memory.rss,
      processHeapUsedBytes: memory.heapUsed,
      processUptimeSeconds: process.uptime(),
      databaseBytes: readFileSize(databasePath),
      databaseWalBytes: readFileSize(`${databasePath}-wal`),
    });
    flushApi(capturedAt);
    const currentTime = now().getTime();
    if (currentTime - lastCleanupAt > 24 * 60 * 60 * 1000) {
      monitoringDatabase.prepare("DELETE FROM system_monitor_samples WHERE capturedAt < ?").run(new Date(currentTime - RAW_RETENTION_MS).toISOString());
      monitoringDatabase.prepare("DELETE FROM system_monitor_api_buckets WHERE bucketAt < ?").run(new Date(currentTime - API_RETENTION_MS).toISOString());
      lastCleanupAt = currentTime;
    }
  }

  function readOverview({ hours = 6 } = {}) {
    const safeHours = [1, 6, 24].includes(Number(hours)) ? Number(hours) : 6;
    const since = new Date(now().getTime() - safeHours * 60 * 60 * 1000).toISOString();
    const samples = monitoringDatabase.prepare("SELECT * FROM system_monitor_samples WHERE capturedAt>=? ORDER BY capturedAt ASC").all(since);
    const apiRows = monitoringDatabase.prepare("SELECT * FROM system_monitor_api_buckets WHERE bucketAt>=? ORDER BY bucketAt ASC").all(since);
    const latest = samples.at(-1) ?? null;
    const durations = apiRows.flatMap((row) => {
      try { return JSON.parse(row.durationsJson); } catch { return []; }
    }).filter(Number.isFinite);
    const requestCount = apiRows.reduce((sum, row) => sum + Number(row.requestCount || 0), 0);
    const errorCount = apiRows.reduce((sum, row) => sum + Number(row.errorCount || 0), 0);
    const slowRoutes = [...apiRows.reduce((routes, row) => {
      const key = `${row.method} ${row.route}`;
      const current = routes.get(key) ?? { route: key, requestCount: 0, totalDurationMs: 0, maxDurationMs: 0, errorCount: 0 };
      current.requestCount += Number(row.requestCount || 0);
      current.totalDurationMs += Number(row.totalDurationMs || 0);
      current.maxDurationMs = Math.max(current.maxDurationMs, Number(row.maxDurationMs || 0));
      current.errorCount += Number(row.errorCount || 0);
      routes.set(key, current);
      return routes;
    }, new Map()).values()].map((item) => ({ ...item, averageDurationMs: item.requestCount ? item.totalDurationMs / item.requestCount : 0 }))
      .sort((left, right) => right.averageDurationMs - left.averageDurationMs).slice(0, 8);
    const business = safeBusinessStatus(getBusinessDatabase);
    const cpuPercent = Number(latest?.cpuPercent || 0);
    const memoryPercent = latest?.memoryTotalBytes ? Number(latest.memoryUsedBytes) / Number(latest.memoryTotalBytes) * 100 : 0;
    const diskPercent = latest?.diskTotalBytes ? Number(latest.diskUsedBytes) / Number(latest.diskTotalBytes) * 100 : 0;
    const errorRate = requestCount ? errorCount / requestCount * 100 : 0;
    const fiveMinutesAgo = now().getTime() - 5 * 60 * 1000;
    const sustainedSamples = samples.filter((sample) => new Date(sample.capturedAt).getTime() >= fiveMinutesAgo);
    const sustainedCpuHigh = sustainedSamples.length >= 20 && sustainedSamples.every((sample) => Number(sample.cpuPercent || 0) >= 85);
    const sustainedMemoryHigh = sustainedSamples.length >= 20 && sustainedSamples.every((sample) => sample.memoryTotalBytes && (Number(sample.memoryUsedBytes) / Number(sample.memoryTotalBytes) * 100) >= 85);
    const alerts = [
      sustainedCpuHigh ? { level: "critical", code: "cpu_high", message: `CPU 使用率连续 5 分钟高于 85%，当前 ${cpuPercent.toFixed(1)}%` } : null,
      sustainedMemoryHigh ? { level: "warning", code: "memory_high", message: `内存使用率连续 5 分钟高于 85%，当前 ${memoryPercent.toFixed(1)}%` } : null,
      diskPercent >= 85 ? { level: "critical", code: "disk_high", message: `磁盘使用率已达 ${diskPercent.toFixed(1)}%` } : null,
      errorRate >= 2 && requestCount >= 10 ? { level: "warning", code: "api_errors", message: `API 5xx 错误率 ${errorRate.toFixed(1)}%` } : null,
      business.openExceptions > 0 ? { level: "warning", code: "data_exceptions", message: `当前有 ${business.openExceptions} 条数据异常待处理` } : null,
    ].filter(Boolean);
    return {
      generatedAt: now().toISOString(), rangeHours: safeHours, retention: { rawDays: 7, apiDays: 30 },
      system: latest ? { ...latest, cpuPercent, memoryPercent, diskPercent, hostname: os.hostname(), platform: os.platform(), cpuCount: os.cpus().length } : null,
      trends: samples.map((sample) => ({ capturedAt: sample.capturedAt, cpuPercent: sample.cpuPercent, memoryPercent: sample.memoryTotalBytes ? sample.memoryUsedBytes / sample.memoryTotalBytes * 100 : 0, diskPercent: sample.diskTotalBytes ? sample.diskUsedBytes / sample.diskTotalBytes * 100 : 0 })),
      api: { requestCount, errorCount, errorRate, p50Ms: percentile(durations, 0.5), p95Ms: percentile(durations, 0.95), p99Ms: percentile(durations, 0.99), slowRoutes },
      service: { status: "online", pid: process.pid, version: applicationVersion, nodeVersion: process.version, startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(), pm2Name: process.env.name || process.env.pm_id !== undefined ? (process.env.name || `pm2-${process.env.pm_id}`) : null },
      database: { status: databaseHealth?.technicalHealth?.status ?? databaseHealth?.status ?? "unknown", pathHidden: true, bytes: Number(latest?.databaseBytes || 0), walBytes: Number(latest?.databaseWalBytes || 0) },
      data: business,
      alerts,
    };
  }

  function start() {
    if (timer !== null) return;
    collect();
    timer = setInterval(collect, Math.max(5_000, Number(intervalMs) || DEFAULT_INTERVAL_MS));
    timer.unref?.();
  }

  function close() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (pendingApi.size > 0) flushApi(now().toISOString());
    monitoringDatabase.close();
  }

  if (autoStart) start();
  return { recordApiRequest, collect, readOverview, start, close, monitoringPath };
}
