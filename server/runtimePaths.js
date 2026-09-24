import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveProductionPaths } = require("./productionPaths.cjs");

function resolveOptionalAbsolutePath(value, variableName) {
  const configured = String(value ?? "").trim();
  if (configured === "") return "";
  if (!path.isAbsolute(configured)) {
    const error = new Error(`${variableName} must be an absolute path`);
    error.code = `${variableName.toLowerCase()}_must_be_absolute`;
    throw error;
  }
  return path.resolve(configured);
}

export function resolveAuthSecretPath({ environment = process.env, defaultDataDir } = {}) {
  if (String(environment.WUFAN_ENV ?? "").trim().toLowerCase() === "production") {
    return resolveProductionPaths(environment).authSecretPath;
  }
  const configured = resolveOptionalAbsolutePath(environment.WUFAN_AUTH_SECRET_PATH, "WUFAN_AUTH_SECRET_PATH");
  return configured || path.join(defaultDataDir, "auth.secret");
}

export function resolveUploadsDirectory({ environment = process.env, projectRoot } = {}) {
  if (String(environment.WUFAN_ENV ?? "").trim().toLowerCase() === "production") {
    return resolveProductionPaths(environment).uploadsPath;
  }
  const configured = resolveOptionalAbsolutePath(environment.WUFAN_UPLOADS_PATH, "WUFAN_UPLOADS_PATH");
  return configured || path.join(projectRoot, "uploads");
}
