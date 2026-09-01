const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX_FAILURES = 10;

export function createLoginRateLimiter({
  windowMs = DEFAULT_WINDOW_MS,
  maxFailures = DEFAULT_MAX_FAILURES,
} = {}) {
  const failures = new Map();

  function normalizeKey(ipAddress, username) {
    return `${String(ipAddress ?? "unknown").trim()}|${String(username ?? "").trim().toLowerCase()}`;
  }

  function read(ipAddress, username, now = Date.now()) {
    const key = normalizeKey(ipAddress, username);
    const current = failures.get(key);
    if (current === undefined || current.resetAt <= now) {
      failures.delete(key);
      return { key, failureCount: 0, resetAt: now + windowMs, blocked: false, retryAfterSeconds: 0 };
    }
    const blocked = current.failureCount >= maxFailures;
    return {
      key,
      failureCount: current.failureCount,
      resetAt: current.resetAt,
      blocked,
      retryAfterSeconds: blocked ? Math.max(1, Math.ceil((current.resetAt - now) / 1000)) : 0,
    };
  }

  function recordFailure(ipAddress, username, now = Date.now()) {
    const snapshot = read(ipAddress, username, now);
    const failureCount = snapshot.failureCount + 1;
    failures.set(snapshot.key, { failureCount, resetAt: snapshot.resetAt });
    return read(ipAddress, username, now);
  }

  function clear(ipAddress, username) {
    failures.delete(normalizeKey(ipAddress, username));
  }

  return { read, recordFailure, clear };
}
