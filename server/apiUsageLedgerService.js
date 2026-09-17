export const API_USAGE_SOURCE_HEADER = "x-wufan-api-source";

const DEFAULT_SOURCE = "unattributed";
const MAX_SOURCE_LENGTH = 80;
const MAX_ROUTE_LENGTH = 300;

function normalizeMethod(value) {
  const method = String(value ?? "GET").trim().toUpperCase();
  return /^[A-Z]{1,16}$/u.test(method) ? method : "UNKNOWN";
}

export function normalizeApiUsageSource(value, fallback = DEFAULT_SOURCE) {
  const normalize = (candidate) => String(candidate ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/([:._])-+/gu, "$1")
    .replace(/^-+|-+$/gu, "")
    .slice(0, MAX_SOURCE_LENGTH);
  return normalize(value) || normalize(fallback) || DEFAULT_SOURCE;
}

function isDynamicPathSegment(segment) {
  if (/^\d+$/u.test(segment)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu.test(segment)) return true;
  if (/^[0-9a-f]{16,}$/iu.test(segment)) return true;
  return /^(?:person|company|department|position|task|goal|product|connection|batch|run|item|record)-[a-z0-9-]*\d[a-z0-9-]*$/iu.test(segment);
}

export function normalizeApiRoutePattern(value) {
  const rawPath = String(value ?? "").split("?")[0].trim();
  const withLeadingSlash = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const segments = withLeadingSlash.split("/").filter(Boolean).map((segment) => {
    if (segment.startsWith(":")) return segment;
    return isDynamicPathSegment(segment) ? ":id" : segment.slice(0, 100);
  });
  const normalized = `/${segments.join("/")}`.replace(/\/{2,}/gu, "/");
  return normalized.slice(0, MAX_ROUTE_LENGTH) || "/api/unknown";
}

export function resolveApiUsageRoute(request) {
  const routePath = request?.route?.path;
  if (typeof routePath === "string" && routePath !== "") return normalizeApiRoutePattern(routePath);
  return normalizeApiRoutePattern(request?.originalUrl ?? request?.path ?? "/api/unknown");
}

export function resolveApiUsageSource(request) {
  const explicitSource = request?.get?.(API_USAGE_SOURCE_HEADER) ?? request?.headers?.[API_USAGE_SOURCE_HEADER];
  if (String(explicitSource ?? "").trim() !== "") return normalizeApiUsageSource(explicitSource);
  const path = String(request?.originalUrl ?? request?.path ?? "").split("?")[0];
  if (path === "/api/health") return "system:health";
  if (path.startsWith("/api/auth/")) return "web:auth";
  return DEFAULT_SOURCE;
}

export function shouldRecordApiUsage(request) {
  const route = String(request?.originalUrl ?? request?.path ?? "").split("?")[0];
  if (["/api/health", "/api/release-maintenance/status"].includes(route)) return false;
  // The data-sync status surface is a strict read model. Even technical usage
  // accounting would turn its GET into a database write and violate that API's
  // no-side-effect contract. Mutating data-sync actions remain recorded.
  if (["GET", "HEAD"].includes(String(request?.method ?? "GET").toUpperCase()) && route.startsWith("/api/data-sync-center")) return false;
  return true;
}

function normalizeApiUsageEvent(input) {
  const accessedAt = input.accessedAt instanceof Date
    ? input.accessedAt.toISOString()
    : new Date(input.accessedAt ?? Date.now()).toISOString();
  const statusCode = Math.max(0, Math.min(999, Math.floor(Number(input.statusCode) || 0)));
  return {
    method: normalizeMethod(input.method),
    routePattern: normalizeApiRoutePattern(input.routePattern),
    source: normalizeApiUsageSource(input.source),
    callCount: Math.max(1, Math.floor(Number(input.callCount) || 1)),
    successCount: statusCode >= 100 && statusCode < 400 ? 1 : 0,
    clientErrorCount: statusCode >= 400 && statusCode < 500 ? 1 : 0,
    serverErrorCount: statusCode >= 500 ? 1 : 0,
    firstAccessAt: accessedAt,
    lastAccessAt: accessedAt,
    lastStatusCode: statusCode,
  };
}

function mergeApiUsageEvent(target, event) {
  target.callCount += event.callCount;
  target.successCount += event.successCount;
  target.clientErrorCount += event.clientErrorCount;
  target.serverErrorCount += event.serverErrorCount;
  if (event.firstAccessAt < target.firstAccessAt) target.firstAccessAt = event.firstAccessAt;
  if (event.lastAccessAt >= target.lastAccessAt) {
    target.lastAccessAt = event.lastAccessAt;
    target.lastStatusCode = event.lastStatusCode;
  }
  return target;
}

function aggregateApiUsageEvents(inputs = []) {
  const rows = new Map();
  for (const input of inputs) {
    const event = input.firstAccessAt && input.lastAccessAt
      ? { ...input }
      : normalizeApiUsageEvent(input);
    const key = `${event.method}\u0000${event.routePattern}\u0000${event.source}`;
    const current = rows.get(key);
    if (current) mergeApiUsageEvent(current, event);
    else rows.set(key, event);
  }
  return [...rows.values()];
}

function upsertApiUsageRows(database, rows) {
  if (rows.length === 0) return 0;
  const statement = database.prepare(`
    INSERT INTO api_usage_ledger (
      method, routePattern, source, callCount, successCount, clientErrorCount, serverErrorCount,
      firstAccessAt, lastAccessAt, lastStatusCode
    ) VALUES (
      @method, @routePattern, @source, @callCount, @successCount, @clientErrorCount, @serverErrorCount,
      @firstAccessAt, @lastAccessAt, @lastStatusCode
    )
    ON CONFLICT(method, routePattern, source) DO UPDATE SET
      callCount = api_usage_ledger.callCount + excluded.callCount,
      successCount = api_usage_ledger.successCount + excluded.successCount,
      clientErrorCount = api_usage_ledger.clientErrorCount + excluded.clientErrorCount,
      serverErrorCount = api_usage_ledger.serverErrorCount + excluded.serverErrorCount,
      firstAccessAt = MIN(api_usage_ledger.firstAccessAt, excluded.firstAccessAt),
      lastStatusCode = CASE
        WHEN excluded.lastAccessAt >= api_usage_ledger.lastAccessAt THEN excluded.lastStatusCode
        ELSE api_usage_ledger.lastStatusCode
      END,
      lastAccessAt = MAX(api_usage_ledger.lastAccessAt, excluded.lastAccessAt)
  `);
  database.transaction((items) => items.forEach((row) => statement.run(row)))(rows);
  return rows.reduce((total, row) => total + row.callCount, 0);
}

export function recordApiUsageBatch(database, inputs = []) {
  return upsertApiUsageRows(database, aggregateApiUsageEvents(inputs));
}

export function recordApiUsage(database, input) {
  return recordApiUsageBatch(database, [input]);
}

export function createApiUsageBatchRecorder(databaseProvider, options = {}) {
  const flushIntervalMs = Math.max(100, Number(options.flushIntervalMs) || 5_000);
  const maxPendingEvents = Math.max(1, Number(options.maxPendingEvents) || 250);
  const onError = typeof options.onError === "function" ? options.onError : () => {};
  const pending = new Map();
  let pendingEventCount = 0;
  let timer = null;
  let closed = false;

  const schedule = () => {
    if (timer || closed || pendingEventCount === 0) return;
    timer = setTimeout(() => {
      timer = null;
      try { flush(); } catch (error) { onError(error); schedule(); }
    }, flushIntervalMs);
    timer.unref?.();
  };
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (pendingEventCount === 0) return 0;
    const rows = [...pending.values()];
    const written = upsertApiUsageRows(databaseProvider(), rows);
    pending.clear();
    pendingEventCount = 0;
    return written;
  };
  const record = (input) => {
    if (closed) return false;
    const event = normalizeApiUsageEvent(input);
    const key = `${event.method}\u0000${event.routePattern}\u0000${event.source}`;
    const current = pending.get(key);
    if (current) mergeApiUsageEvent(current, event);
    else pending.set(key, event);
    pendingEventCount += 1;
    if (pendingEventCount >= maxPendingEvents) flush();
    else schedule();
    return true;
  };
  const close = () => {
    if (closed) return 0;
    const written = flush();
    closed = true;
    return written;
  };

  return {
    record,
    flush,
    close,
    get pendingEventCount() { return pendingEventCount; },
    get pendingKeyCount() { return pending.size; },
  };
}

function buildLedgerFilters(input = {}) {
  const conditions = [];
  const params = {};
  const method = String(input.method ?? "").trim().toUpperCase();
  const source = String(input.source ?? "").trim();
  const route = String(input.route ?? "").trim();
  if (method !== "") {
    conditions.push("method = @method");
    params.method = normalizeMethod(method);
  }
  if (source !== "") {
    conditions.push("source = @source");
    params.source = normalizeApiUsageSource(source);
  }
  if (route !== "") {
    conditions.push("routePattern LIKE @route");
    params.route = `%${route.slice(0, MAX_ROUTE_LENGTH)}%`;
  }
  return { where: conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`, params };
}

export function getApiUsageLedger(database, input = {}) {
  const { where, params } = buildLedgerFilters(input);
  const limit = Math.floor(Math.min(500, Math.max(1, Number(input.limit) || 200)));
  const items = database.prepare(`
    SELECT method, routePattern, source, callCount, successCount, clientErrorCount, serverErrorCount,
           firstAccessAt, lastAccessAt, lastStatusCode
    FROM api_usage_ledger
    ${where}
    ORDER BY lastAccessAt DESC, callCount DESC, routePattern ASC
    LIMIT @limit
  `).all({ ...params, limit });
  const summary = database.prepare(`
    SELECT COUNT(*) AS ledgerEntries,
           COALESCE(SUM(callCount), 0) AS totalCalls,
           COALESCE(SUM(successCount), 0) AS successfulCalls,
           COALESCE(SUM(clientErrorCount), 0) AS clientErrorCalls,
           COALESCE(SUM(serverErrorCount), 0) AS serverErrorCalls,
           MIN(firstAccessAt) AS firstAccessAt,
           MAX(lastAccessAt) AS lastAccessAt
    FROM api_usage_ledger
    ${where}
  `).get(params);
  return { summary, items };
}
