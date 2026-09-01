import path from "node:path";

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
  const configured = resolveOptionalAbsolutePath(environment.WUFAN_AUTH_SECRET_PATH, "WUFAN_AUTH_SECRET_PATH");
  return configured || path.join(defaultDataDir, "auth.secret");
}

export function resolveUploadsDirectory({ environment = process.env, projectRoot } = {}) {
  const configured = resolveOptionalAbsolutePath(environment.WUFAN_UPLOADS_PATH, "WUFAN_UPLOADS_PATH");
  return configured || path.join(projectRoot, "uploads");
}
