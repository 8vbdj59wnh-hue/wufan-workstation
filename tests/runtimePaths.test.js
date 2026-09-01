import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { resolveAuthSecretPath, resolveUploadsDirectory } from "../server/runtimePaths.js";

const projectRoot = "/private/tmp/wufan-runtime-path-test";
const defaultDataDir = path.join(projectRoot, "data");

test("runtime assets and auth secret keep repository defaults", () => {
  assert.equal(resolveAuthSecretPath({ environment: {}, defaultDataDir }), path.join(defaultDataDir, "auth.secret"));
  assert.equal(resolveUploadsDirectory({ environment: {}, projectRoot }), path.join(projectRoot, "uploads"));
});

test("runtime assets and auth secret accept explicit absolute shared paths", () => {
  assert.equal(resolveAuthSecretPath({
    environment: { WUFAN_AUTH_SECRET_PATH: "/private/tmp/shared/auth.secret" },
    defaultDataDir,
  }), "/private/tmp/shared/auth.secret");
  assert.equal(resolveUploadsDirectory({
    environment: { WUFAN_UPLOADS_PATH: "/private/tmp/shared/uploads" },
    projectRoot,
  }), "/private/tmp/shared/uploads");
});

test("runtime path overrides reject ambiguous relative paths", () => {
  assert.throws(() => resolveAuthSecretPath({
    environment: { WUFAN_AUTH_SECRET_PATH: "data/auth.secret" },
    defaultDataDir,
  }), (error) => error.code === "wufan_auth_secret_path_must_be_absolute");
  assert.throws(() => resolveUploadsDirectory({
    environment: { WUFAN_UPLOADS_PATH: "uploads" },
    projectRoot,
  }), (error) => error.code === "wufan_uploads_path_must_be_absolute");
});
