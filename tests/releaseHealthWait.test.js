import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";

const repository = path.resolve(import.meta.dirname, "..");
const waitScript = path.join(repository, "scripts", "release-wait-for-health.sh");
const releaseScript = fs.readFileSync(path.join(repository, "scripts", "release-from-package.sh"), "utf8");

function runWait(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(waitScript, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    return await callback(server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("health waiter retries transient startup failures until HTTP health succeeds", async () => {
  let attempts = 0;
  await withServer((_request, response) => {
    attempts += 1;
    response.statusCode = attempts < 3 ? 503 : 200;
    response.end(attempts < 3 ? "starting" : "ok");
  }, async (port) => {
    const result = await runWait([
      "--url", `http://127.0.0.1:${port}/health`,
      "--label", "test-backend",
      "--total-seconds", "5",
      "--interval-seconds", "1",
      "--request-timeout-seconds", "1",
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /HEALTH_READY label=test-backend attempts=3/u);
    assert.equal(attempts, 3);
  });
});

test("health waiter fails only after its bounded total window", async () => {
  await withServer((_request, response) => {
    response.statusCode = 503;
    response.end("starting");
  }, async (port) => {
    const startedAt = Date.now();
    const result = await runWait([
      "--url", `http://127.0.0.1:${port}/health`,
      "--label", "test-timeout",
      "--total-seconds", "2",
      "--interval-seconds", "1",
      "--request-timeout-seconds", "1",
    ]);
    assert.notEqual(result.code, 0);
    assert.ok(Date.now() - startedAt >= 1_800, `waited only ${Date.now() - startedAt}ms`);
    assert.match(result.stderr, /HEALTH_WAIT_TIMEOUT label=test-timeout/u);
  });
});

test("formal release uses bounded periodic waits before the unchanged health-after gate", () => {
  assert.match(releaseScript, /--label frontend[\s\S]*--total-seconds 60[\s\S]*--request-timeout-seconds 5/u);
  assert.match(releaseScript, /--label backend[\s\S]*--total-seconds 180[\s\S]*--request-timeout-seconds 8/u);
  const stabilization = releaseScript.indexOf('STAGE="service-stabilization"');
  const waiter = releaseScript.indexOf('scripts/release-wait-for-health.sh', stabilization);
  const healthAfter = releaseScript.indexOf('STAGE="health-after"');
  assert.ok(stabilization > 0 && waiter > stabilization && healthAfter > waiter);
  assert.match(releaseScript.slice(healthAfter), /scripts\/release-health-check\.sh/u);
});
