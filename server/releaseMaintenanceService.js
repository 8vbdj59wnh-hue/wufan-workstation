import fs from "node:fs";
import path from "node:path";

const activeJobs = new Map();
let nextToken = 0;

export function resolveReleaseMaintenancePath(environment = process.env) {
  const explicit = String(environment.WUFAN_RELEASE_MAINTENANCE_PATH ?? "").trim();
  if (explicit) return path.resolve(explicit);
  const databasePath = String(environment.WUFAN_DB_PATH ?? "").trim();
  if (databasePath) return path.join(path.dirname(path.resolve(databasePath)), "release-maintenance.json");
  return path.resolve("data/release-maintenance.json");
}

export function isReleaseMaintenanceModeActive(options = {}) {
  const environment = options.environment ?? process.env;
  if (["1", "true", "on"].includes(String(environment.WUFAN_RELEASE_MAINTENANCE ?? "").trim().toLowerCase())) return true;
  return fs.existsSync(options.markerPath ?? resolveReleaseMaintenancePath(environment));
}

export function beginReleaseManagedJob(jobType, options = {}) {
  if (isReleaseMaintenanceModeActive(options)) return null;
  const token = `${process.pid}:${Date.now()}:${nextToken += 1}`;
  activeJobs.set(token, { jobType, startedAt: new Date().toISOString() });
  return token;
}

export function finishReleaseManagedJob(token) {
  if (token) activeJobs.delete(token);
}

export function readReleaseMaintenanceStatus(options = {}) {
  const jobs = [...activeJobs.entries()].map(([token, job]) => ({ token, ...job }));
  return {
    active: isReleaseMaintenanceModeActive(options),
    activeWriteJobs: jobs.length,
    jobs,
    markerPath: options.markerPath ?? resolveReleaseMaintenancePath(options.environment ?? process.env),
    checkedAt: new Date().toISOString(),
  };
}

export function writeReleaseMaintenanceMarker(input = {}, options = {}) {
  const markerPath = options.markerPath ?? resolveReleaseMaintenancePath(options.environment ?? process.env);
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  const temporaryPath = `${markerPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify({
    active: true,
    reason: input.reason ?? "production_release",
    releaseId: input.releaseId ?? null,
    requestedAt: input.requestedAt ?? new Date().toISOString(),
  }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, markerPath);
  return markerPath;
}

export function clearReleaseMaintenanceMarker(options = {}) {
  const markerPath = options.markerPath ?? resolveReleaseMaintenancePath(options.environment ?? process.env);
  if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);
  return markerPath;
}
