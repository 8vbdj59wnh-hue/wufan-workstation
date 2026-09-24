"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REQUIRED_KEYS = Object.freeze([
  "WUFAN_PROJECT_DIR",
  "WUFAN_DATA_ROOT",
  "WUFAN_DB_PATH",
  "WUFAN_DB_BASELINE_PATH",
  "WUFAN_UPLOADS_PATH",
  "WUFAN_AUTH_SECRET_PATH",
  "WUFAN_RELEASE_ROOT",
]);

function pathError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function clean(value) {
  return String(value ?? "").trim();
}

function canonicalizePath(value, variableName) {
  const configured = clean(value);
  if (!configured) throw pathError(`${variableName.toLowerCase()}_required`);
  if (!path.isAbsolute(configured)) throw pathError(`${variableName.toLowerCase()}_must_be_absolute`);
  if (/[\0\r\n]/u.test(configured)) throw pathError(`${variableName.toLowerCase()}_invalid`);
  const absolute = path.resolve(configured);
  const suffix = [];
  let cursor = absolute;
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  const physical = fs.existsSync(cursor) ? fs.realpathSync.native(cursor) : cursor;
  return path.resolve(physical, ...suffix);
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertPersistentLocalPath(resolved, variableName) {
  const temporaryRoots = [os.tmpdir(), "/tmp", "/private/tmp", "/var/tmp"].map((item) => path.resolve(item));
  if (temporaryRoots.some((root) => isInside(resolved, root))) {
    throw pathError(`${variableName.toLowerCase()}_temporary_path_forbidden`);
  }
  if (["/Volumes", "/Network", "/net", "/afs"].some((root) => isInside(resolved, root))) {
    throw pathError(`${variableName.toLowerCase()}_network_path_forbidden`);
  }
}

function resolveProductionPaths(environment = process.env, { requireBackupRoot = false } = {}) {
  for (const key of REQUIRED_KEYS) {
    if (!clean(environment[key])) throw pathError(`${key.toLowerCase()}_required`);
  }
  const projectDir = canonicalizePath(environment.WUFAN_PROJECT_DIR, "WUFAN_PROJECT_DIR");
  const dataRoot = canonicalizePath(environment.WUFAN_DATA_ROOT, "WUFAN_DATA_ROOT");
  const databasePath = canonicalizePath(environment.WUFAN_DB_PATH, "WUFAN_DB_PATH");
  const baselinePath = canonicalizePath(environment.WUFAN_DB_BASELINE_PATH, "WUFAN_DB_BASELINE_PATH");
  const uploadsPath = canonicalizePath(environment.WUFAN_UPLOADS_PATH, "WUFAN_UPLOADS_PATH");
  const authSecretPath = canonicalizePath(environment.WUFAN_AUTH_SECRET_PATH, "WUFAN_AUTH_SECRET_PATH");
  const releaseRoot = canonicalizePath(environment.WUFAN_RELEASE_ROOT, "WUFAN_RELEASE_ROOT");
  const backupValue = clean(environment.WUFAN_BACKUP_ROOT);
  if (requireBackupRoot && !backupValue) throw pathError("wufan_backup_root_required");
  const backupRoot = backupValue ? canonicalizePath(backupValue, "WUFAN_BACKUP_ROOT") : "";
  const logValue = clean(environment.WUFAN_PM2_LOG_ROOT) || path.join(os.homedir(), ".pm2", "logs");
  const pm2LogRoot = canonicalizePath(logValue, "WUFAN_PM2_LOG_ROOT");

  for (const [name, value] of Object.entries({
    WUFAN_PROJECT_DIR: projectDir,
    WUFAN_DATA_ROOT: dataRoot,
    WUFAN_DB_PATH: databasePath,
    WUFAN_DB_BASELINE_PATH: baselinePath,
    WUFAN_UPLOADS_PATH: uploadsPath,
    WUFAN_AUTH_SECRET_PATH: authSecretPath,
    WUFAN_RELEASE_ROOT: releaseRoot,
    ...(backupRoot ? { WUFAN_BACKUP_ROOT: backupRoot } : {}),
    WUFAN_PM2_LOG_ROOT: pm2LogRoot,
  })) assertPersistentLocalPath(value, name);

  if (isInside(databasePath, projectDir)) throw pathError("production_database_path_inside_repository");
  if (!isInside(databasePath, dataRoot)) throw pathError("production_database_path_outside_data_root");
  if (!isInside(baselinePath, dataRoot)) throw pathError("production_baseline_path_outside_data_root");
  if (!isInside(uploadsPath, dataRoot)) throw pathError("production_uploads_path_outside_data_root");
  if (!isInside(authSecretPath, dataRoot)) throw pathError("production_auth_secret_path_outside_data_root");
  if (isInside(dataRoot, projectDir) || isInside(projectDir, dataRoot)) {
    throw pathError("production_data_root_must_be_separate_from_repository");
  }
  if (isInside(releaseRoot, projectDir)) throw pathError("production_release_root_inside_repository");
  if (backupRoot && isInside(backupRoot, projectDir)) throw pathError("production_backup_root_inside_repository");

  return Object.freeze({
    projectDir,
    dataRoot,
    databasePath,
    baselinePath,
    uploadsPath,
    authSecretPath,
    releaseRoot,
    backupRoot,
    pm2LogRoot,
  });
}

module.exports = {
  REQUIRED_KEYS,
  canonicalizePath,
  isInside,
  resolveProductionPaths,
};
