import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const helper = path.resolve(import.meta.dirname, "../scripts/lib/node-runtime.sh");

function createRuntimeFixture(major = "22") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wufan-node-runtime-"));
  const node = path.join(directory, "node");
  const npm = path.join(directory, "npm");
  const pm2 = path.join(directory, "pm2");
  fs.writeFileSync(node, `#!/bin/sh\nprintf '%s\\n' '${major}'\n`, { mode: 0o755 });
  fs.writeFileSync(npm, "#!/bin/sh\nprintf '%s\\n' '10.9.9'\n", { mode: 0o755 });
  fs.writeFileSync(pm2, "#!/bin/sh\nprintf '%s\\n' '7.0.4'\n", { mode: 0o755 });
  return { directory, node, npm, pm2 };
}

function resolveRuntime(environment) {
  return spawnSync("/bin/bash", [
    "-c",
    `source "$1"; wufan_resolve_node_runtime || exit $?; printf 'node=%s\\nnpm=%s\\npm2=%s\\n' "$NODE_COMMAND" "$NPM_COMMAND" "$PM2_COMMAND"`,
    "wufan-node-runtime-test",
    helper,
  ], {
    env: {
      ...process.env,
      WUFAN_NODE_COMMAND: "",
      WUFAN_NODE22_BIN: "",
      WUFAN_NPM_COMMAND: "",
      WUFAN_PM2_COMMAND: "",
      ...environment,
    },
    encoding: "utf8",
  });
}

test("runtime resolver accepts explicit Node and npm commands outside Homebrew", () => {
  const fixture = createRuntimeFixture();
  try {
    const result = resolveRuntime({
      WUFAN_NODE_COMMAND: fixture.node,
      WUFAN_NPM_COMMAND: fixture.npm,
      WUFAN_PM2_COMMAND: fixture.pm2,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`node=${fixture.node}`));
    assert.match(result.stdout, new RegExp(`npm=${fixture.npm}`));
    assert.match(result.stdout, new RegExp(`pm2=${fixture.pm2}`));
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("runtime resolver supports a configured Node bin directory and sibling npm", () => {
  const fixture = createRuntimeFixture();
  try {
    const result = resolveRuntime({
      WUFAN_NODE22_BIN: fixture.directory,
      WUFAN_PM2_COMMAND: fixture.pm2,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`node=${fixture.node}`));
    assert.match(result.stdout, new RegExp(`npm=${fs.realpathSync(fixture.npm)}`));
    assert.match(result.stdout, new RegExp(`pm2=${fixture.pm2}`));
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("runtime resolver rejects an explicitly configured non-Node-22 runtime", () => {
  const fixture = createRuntimeFixture("24");
  try {
    const result = resolveRuntime({
      WUFAN_NODE_COMMAND: fixture.node,
      WUFAN_NPM_COMMAND: fixture.npm,
      WUFAN_PM2_COMMAND: fixture.pm2,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Node\.js major version must be 22/u);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});
