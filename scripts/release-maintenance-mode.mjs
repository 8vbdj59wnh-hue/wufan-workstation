import process from "node:process";
import {
  clearReleaseMaintenanceMarker,
  readReleaseMaintenanceStatus,
  writeReleaseMaintenanceMarker,
} from "../server/releaseMaintenanceService.js";

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

async function remoteStatus(statusUrl) {
  const response = await fetch(statusUrl, {
    headers: { "x-wufan-api-source": "system:release" },
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error(`maintenance_status_http_${response.status}`);
  return response.json();
}

async function waitUntilQuiet() {
  const statusUrl = argument("--status-url", "http://127.0.0.1:3001/api/release-maintenance/status");
  const timeoutMs = Number(argument("--timeout-ms", "120000"));
  const pollMs = Number(argument("--poll-ms", "100"));
  const started = Date.now();
  let lastStatus = null;
  while (Date.now() - started <= timeoutMs) {
    try {
      lastStatus = await remoteStatus(statusUrl);
    } catch (error) {
      error.code = "maintenance_status_unavailable";
      throw error;
    }
    if (lastStatus.active === true && Number(lastStatus.activeWriteJobs) === 0) {
      return { ...lastStatus, waitedMs: Date.now() - started };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  const error = new Error("release_maintenance_drain_timeout");
  error.code = "release_maintenance_drain_timeout";
  error.status = lastStatus;
  throw error;
}

const command = process.argv[2];
try {
  let result;
  if (command === "enter") {
    const markerPath = writeReleaseMaintenanceMarker({
      reason: argument("--reason", "production_release"),
      releaseId: argument("--release-id", null),
    });
    result = { success: true, action: "enter", markerPath, ...readReleaseMaintenanceStatus() };
  } else if (command === "wait") {
    result = { success: true, action: "wait", ...await waitUntilQuiet() };
  } else if (command === "status") {
    result = { success: true, action: "status", ...readReleaseMaintenanceStatus() };
  } else if (command === "exit") {
    const markerPath = clearReleaseMaintenanceMarker();
    result = { success: true, action: "exit", markerPath, ...readReleaseMaintenanceStatus() };
  } else {
    throw new Error("release_maintenance_command_invalid");
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    success: false,
    error: error.code ?? error.message,
    message: error.message,
    status: error.status ?? null,
  })}\n`);
  process.exitCode = 1;
}
