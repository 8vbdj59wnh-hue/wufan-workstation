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
  fs.writeFileSync(node, `#!/bin/sh\nprintf '%s\\n' '${major}'\n`, { mode: 0o755 });
  fs.writeFileSync(npm, "#!/bin/sh\nprintf '%s\\n' '10.9.9'\n", { mode: 0o755 });
  return { directory, node, npm };
}

function resolveRuntime(environment) {
  return spawnSync("/bin/bash", [
    "-c",
    `source "$1"; wufan_resolve_node_runtime || exit $?; printf 'node=%s\\nnpm=%s\\n' "$NODE_COMMAND" "$NPM_COMMAND"`,
    "wufan-node-runtime-test",
    helper,
  ], {
    env: { ...process.env, WUFAN_NODE_COMMAND: "", WUFAN_NODE22_BIN: "", WUFAN_NPM_COMMAND: "", ...environment },
    encoding: "utf8",
  });
}

test("runtime resolver accepts explicit Node and npm commands outside Homebrew", () => {
  const fixture = createRuntimeFixture();
  try {
    const result = resolveRuntime({
      WUFAN_NODE_COMMAND: fixture.node,
      WUFAN_NPM_COMMAND: fixture.npm,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`node=${fixture.node}`));
    assert.match(result.stdout, new RegExp(`npm=${fixture.npm}`));
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("runtime resolver supports a configured Node bin directory and sibling npm", () => {
  const fixture = createRuntimeFixture();
  try {
    const result = resolveRuntime({ WUFAN_NODE22_BIN: fixture.directory });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`node=${fixture.node}`));
    assert.match(result.stdout, new RegExp(`npm=${fs.realpathSync(fixture.npm)}`));
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
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Node\.js major version must be 22/u);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});
